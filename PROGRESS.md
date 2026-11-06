# Project status

An artificial-life and ecosystem simulation: procedural terrain, creatures with heritable genomes,
energy and nutrient cycles, speciation and extinction. The core is headless.

**Nothing is viewable yet.** There is no app entry, no component and no renderer, so `npm run dev`
shows a blank page. See §3.

_Notes below were checked against the files in this working tree. Anything not established is filed as
an open question in §6 rather than stated as fact._

---

## 1. Status by milestone

| Milestone | State | What is actually there |
|---|---|---|
| 1 Foundation | **mostly done** | Vite + TypeScript scaffold, seeded serialisable RNG, procedural world/terrain, headless engine with ordered fixed-timestep updates, save/restore state |
| 2 Life | **done** | creatures with energy/health/age, movement, grazing, hunting, attacks, breeding with inheritance and mutation, death causes, census |
| 3 Evolution | **done** | genome → phenotype mapping with allometry, crossover and mutation, speciation and extinction bookkeeping, climate/thermal and crowding pressures, trait statistics over time |
| 4 Interface | **absent** | no `src/main.ts`, no `src/App.vue`, no components, no canvas renderer, no charts |
| 5 Quality | **thin** | two probe files exist and **both currently fail to run**; no assertion-based tests |
| 6 Performance / E2E | **not started** | the `test:perf` / `test:e2e` scripts point at a config and a runner that do not exist |

---

## 2. What actually exists

```
index.html                 app shell; requests /src/main.ts, which does not exist
package.json  vite.config.ts  tsconfig.json  tsconfig.app.json  tsconfig.node.json  PROGRESS.md

src/sim/rng.ts        seeded PRNG with named streams and saveable state
src/sim/noise.ts      value noise + fbm, used for terrain
src/sim/world.ts      terrain, vegetation, soil fertility, mineral pool, temperature/seasons,
                      `graze`, `takeMineral`, `releaseNutrients`, `totalBiomass`, `totalDetritus`
src/sim/traits.ts     trait table with founder values per diet class, `buildPhenotype` (allometry:
                      mass, basal rate, bite sizes, thermal limits, reproductive costs), crossover,
                      mutation, trait descriptions for tooltips
src/sim/species.ts    species registry, centroid genomes, speciation and extinction bookkeeping
src/sim/lineage.ts    compact parent-of-creature genealogy (inbreeding checks for mating)
src/sim/spatial.ts    spatial hash grid used for neighbour queries
src/sim/stats.ts      census, per-trait statistics, history ring buffers
src/sim/config.ts     `defaultConfig()`, scenario presets (`SCENARIOS`)
src/sim/types.ts      shared types, behaviour constants, `DEATH_CAUSES`, `dietClassOf`
src/sim/engine.ts     the step function, `EnergyLedger`, `auditEnergy()`, event log, census history,
                      `toState()` / `fromState()` with `SIM_STATE_VERSION`

tests/physiology.test.ts   probe: does not run (see §5)
tests/scratch.test.ts      probe for the meat-eater question (see §7; currently broken)
```

There is no `src/main.ts`, no `src/App.vue`, no `src/ui/`, no `src/render/` and no `src/sim/index.ts`
barrel; the sim modules import each other directly and save/restore lives inside `engine.ts`
(`toState()` / `fromState()`, `SIM_STATE_VERSION`).

---

## 3. Why nothing renders

`index.html` mounts `#app` and requests `/src/main.ts`; `src/` contains only `src/sim/`. To see
anything, these pieces have to be written:

1. `src/main.ts` — create the app, own a `Simulation`, drive a bounded fixed-timestep loop
   (`requestAnimationFrame`, a capped number of ticks per frame, pause / single-step).
2. `src/App.vue` + control panel — play/pause/step, speed, seed, scenario presets.
3. A canvas renderer that only *reads* simulation state: terrain and vegetation from `world`'s tile
   arrays, creatures from `sim.creatures`, plus a minimap. It must never write simulation state.
4. Live panels fed by the census history (`sim.seriesSamples` / `sim.seriesLatest`) and
   `sim.auditEnergy()` — population by diet class, biomass and detritus pools, the energy audit,
   per-trait statistics, the event log.

Nothing in the simulation core has to change for this; the interface consumes the public API as it is.

---

## 4. Energy and nutrient accounting as it stands

Boundary fluxes are booked under names rather than dumped into a residual:

```
EnergyLedger: initial · photosynthesis · plantRespiration · decomposition · burial · lifeHeat
```

`auditEnergy()` sums the live pools (`totalBiomass + totalDetritus + creature energy`) and compares
them with the ledger total (`initial + photosynthesis − plantRespiration − decomposition − burial −
lifeHeat`), returning `total`, `expected` and their difference `delta`.

An animal's whole bill is computed together (`metabolic + moveCost + thermoCost`, engine.ts 555–562), paid
by one `c.energy -=` line, and the sum is added to `lifeHeat`; `world.releaseNutrients(tile, spent)`
returns a fixed share of it to the soil tile the animal stands on. Feeding waste and carcass leftovers
are deposited onto tiles (`deposit`), and what the soil cannot hold is booked as `burial`.

The bill is clamped to the energy an animal actually holds (`spent = min(c.energy, costs)`), so nobody
can borrow ahead: no heat is booked that did not leave the biomass pool. `c.energy <= 0` after that
clamp is death by `starvation`.

What is **not** in place:

- **Nothing asserts that the cycle closes.** There is no conservation test; the audit is only printed
  by the (currently broken) probe.
- **Metabolism, movement and thermoregulation are indistinguishable** inside `lifeHeat`, and the
  `releaseNutrients` return fraction is a constant rather than something derived or measured. An
  energy shortfall in an animal therefore cannot be attributed to a cause.
- **Meat and plants are not separated in the ledger.** Both raise `c.energy` through the same
  `digest`-weighted absorption (`0.45 + 0.45 × digest` on a kill, `digest` on a bite), so
  "carnivores are starving" and "there is no forage here" produce the same numbers.
- **`digest` scales both channels at once**, so raising it to help hunters also changes grazing —
  which is why §6 has to be measured before any change to it.

---

## 5. Known broken things (as measured in this pass)

1. **`tests/physiology.test.ts` errors** — `ReferenceError: buildGenome is not defined` at
   `tests/physiology.test.ts:17`. It calls a `buildGenome(...)` helper it never defines; the module it
   relies on exports `founderGenome` / `buildPhenotype`.
2. **`tests/scratch.test.ts` does not run.** It is mid-edit: `carnivores` (line 68), `reachable` (86),
   `sighted` (88, 102) and `meter` (153–158) are used but never defined; `meanBurn` is declared and
   never accumulated; the returned object repeats `tooHeavy` and names a field `energyReachable` where
   its own type declares `energyInReach`; `sim.run()` is called with no tick count; and `huntMeter`
   instruments only `attack` — the foraging and breeding channels described in §7 are not wired up.
3. **`npm run test` reports `Tests 2 failed`**, and `npx vue-tsc --noEmit` reports 25 further errors
   across these two files: the undefined names above plus unused bindings (`restore`, `audit`,
   `bandCounts`, `kill`), which are errors because `noUnusedLocals` is enabled and
   `tsconfig.app.json` includes `tests/**/*.ts`. `npm run build` runs `vue-tsc` first, so it stops for
   the same reason.
4. **`npm run test:perf` and `npm run test:all` cannot run**: `vitest.perf.config.ts` does not exist.
5. **`npm run test:e2e` cannot run**: `playwright` is neither a dependency nor installed, and there is
   no Playwright config or test directory.
6. **No test covers the simulation core** — nothing asserts determinism, feeding, inheritance,
   speciation or conservation.
7. The **open question in §6 is unanswered**, and the tool built to answer it is one of the two
   broken files.

---

## 6. Open question — why strict meat-eaters starve

**Rules read from the current engine:**

- Behaviour selection sends an animal hunting when `diet ≥ 0.6` while it is starving, and when
  `diet > 0.66` at ordinary hunger. Inside `behaveHunt`, a bite of plants is only allowed below
  `0.2`, and the fallback from hunting back to grazing only fires below `0.7`. So **animals at or
  above `0.7` have no plant channel at all**, and `dietClassOf` labels anything above `0.66` as
  `carnivore`.
- Prey must pass all three gates: a different species, `prey.mass < hunter.mass * (0.35 + 1.7 × diet)`,
  and `prey.energy > 0.2`. An animal holding less than `0.2` energy is not visible as prey even when
  it is standing next to a starving hunter.
- Only a kill transfers energy. `attack()` returns immediately if the prey survives the damage; the
  hunter has already paid the movement and metabolic cost of reaching it. Absorbed energy on a kill is
  `min(maxEnergy − energy, prey.energy × (0.45 + 0.45 × digest))`; the rest is deposited on the tile.
- Founders are seeded (traits.ts) with diet `herbivore 0.08 / carnivore 0.9`, size
  `herbivore 0.34 / carnivore 0.5` and metabolic rate `herbivore 1.15 / carnivore 1.35`. The starting
  carnivores are therefore strict meat-eaters with the highest metabolic bill in the population.

**Open question.** Whether carnivores fail because there is no prey in reach, because nearby animals
are too thin to be worth chasing, because they are too heavy to be eaten, because one kill is smaller
than a daily bill, or because the walk to food costs more than the food provides — **unknown, and
currently indistinguishable from the engine's own output**. §7 exists to measure this.

Until one of those is shown to dominate, changing `digest`, the meat transfer, the metabolic bill or
the prey gates is guessing.

---

## 7. The measurement probe (`tests/scratch.test.ts`)

`tests/scratch.test.ts`, "probe: the top of the food web": turns §6 into numbers without changing any
engine rule. It is a diagnostic harness, not a test with assertions — deliberately so; it reports, and
the assertions belong later (§8 step 4).

**Cohort, not population.** Every strict meat-eater (`diet ≥ 0.7`) is tagged by creature id at the
start of the run and every measurement is attributed to those individuals. A mean over survivors would
hide a cohort that is dying one animal at a time.

**Intake is measured where the engine actually changes an animal's energy**, by wrapping the engine's
own methods on the instance and restoring them after the run:

| Channel | What it measures | Why the reading is trustworthy |
|---|---|---|
| `attack` | energy gained from a kill, the energy the prey held, how many attacks killed nothing | a kill changes `c.energy` in exactly one line |
| `behaveForage` | plant energy absorbed | the only energy-changing step there is `c.energy += absorbed` |
| `breed` | energy given away to offspring | reproduction is the only other consumer of a creature's energy |

The engine's costs are **not** reimplemented by the probe. The bill is read off each animal instead —
`ph.basalRate` (halved while resting), the movement cost `ph.moveCostCoefficient × moved²`, and
`ph.thermalPenalty` when the tile temperature is outside the animal's tolerance band, exactly as
`updateCreature` adds them (engine.ts 555–562). Measured intake and the real bill are then directly
comparable, and the probe has invented no arithmetic of its own.

**Prey availability is evaluated with the engine's own gates.** Periodically the probe walks each
tagged animal's neighbourhood and counts candidates that pass all three gates, ones rejected by the
mass gate, ones rejected by the chase threshold, the energy actually obtainable inside `senseRadius`,
and the distance to the nearest legal prey anywhere in the world. That is what separates "no prey
exists" from "prey out of sight" from "prey too thin to chase".

**Per window it prints:** cohort size at the start → alive at the end; mean absorbed energy per
animal per tick per channel; mean bill; meals per animal and how many ticks of cost one meal covers;
the prey-reach breakdown; `auditEnergy()` for the world; deaths by cause since the last window.

**Current state: it does not run** — see §5 items 1–3. Rebuilding the cohort bookkeeping exactly as
described above is the first code task after this document.

---

## 8. Order of work

1. Restore `tests/scratch.test.ts` to the design in §6 and run it (10 windows × 200 ticks on
   `defaultConfig()`): cohort budgets, prey-reach breakdown, world audit, deaths.
2. Read the numbers, identify which cause in §5 dominates, and write the answer into §5.
3. Change one rule at a time and confirm it with the same probe.
4. Turn the measurements into permanent tests (`conservation.test.ts` for the energy and nutrient
   cycles, `population.test.ts` for persistence), and keep the probe as documentation of the diagnosis.
5. Then the interface in §3: a canvas world plus live panels, so the diagnosis is visible rather than
   only printed.
6. Performance work only after there is a real render path to measure.

---

## 9. Commands

```
npm run dev                              # dev server — renders nothing today (no src/main.ts)
npm run test                           # vitest — currently 2 failures, both in tests/
npm run typecheck                    # vue-tsc — currently fails; it type-checks tests/**/*.ts
npx vitest run tests/scratch.test.ts   # the food-web probe on its own
npm run test:perf                    # not usable: vitest.perf.config.ts does not exist
npm run test:e2e                     # not usable: playwright is not installed
```

Note: `npx vitest run` at the repository root matches no test files, because the package lives in the
nested `EvoLab/` folder; run the suite from `EvoLab/`.
