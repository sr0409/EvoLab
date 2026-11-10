# Project status

An artificial-life and ecosystem simulation: procedural terrain, creatures with heritable genomes,
energy and nutrient cycles, speciation and extinction — now viewable live in the browser
(`npm run dev` serves the interface described in §3).

_Notes below were checked against the files in this working tree. Anything not established is filed as
an open question in §6 rather than stated as fact._

---

## 1. Status by milestone

| Milestone | State | What is actually there |
|---|---|---|
| 1 Foundation | **mostly done** | Vite + TypeScript scaffold, seeded serialisable RNG, procedural world/terrain, headless engine with ordered fixed-timestep updates, save/restore state |
| 2 Life | **done, measured gap** | creatures with energy/health/age, movement, grazing, hunting, attacks, breeding with inheritance and mutation, death causes, census. The carnivore diet band does not persist in long runs; see §5 and §6 |
| 3 Evolution | **done** | genome → phenotype mapping with allometry, crossover and mutation, speciation and extinction bookkeeping, climate/thermal and crowding pressures, trait statistics over time |
| 4 Interface | **done, verified live** | `src/main.ts`, `src/App.vue`, `src/store.ts` (loop + UI state; the Simulation is kept out of Vue reactivity), canvas world renderer (terrain / biomass / temperature views + creature overlay), live census & energy-audit panel, time-series charts (`CHART_FIELDS`), species roster, event log, and a manual population-cap control in the run bar. Verified against the running dev server: tick advances, canvas paints, panels populate |
| 5 Quality | **done, 25 tests pass** | engine fix: offspring now record both parents in the lineage store (`makeCreature` took no parent ids before). Assertion tests: `tests/conservation.test.ts` (ledger balances across 1000 ticks, pool accounting, brood energy handover), `tests/determinism.test.ts` (same seed → identical state; different seeds diverge), `tests/lineage.test.ts` (inherit stays inside parent bounds, mutate stays in trait ranges, engine genealogy complete/acyclic, ages match birth ticks), `tests/population.test.ts` (census on schedule, diet classes partition the population, births/deaths census records add up, species bookkeeping). Shared `tests/helpers.ts` gives a 48×48 test world. `npm run test` → 6 files / 25 tests pass; `npm run build` clean. (Now 10 files / 54 tests: `tests/min-prey-energy.test.ts`, `tests/population-cap.test.ts`, `tests/assimilation-base.test.ts`, and `tests/juvenile-plant-allowance.test.ts` were added with the controls described in §3.) |
| 6 Performance / E2E | **done, measured** | `vitest.perf.config.ts` + `tests/perf/engine.perf.ts` (a separate runner; `*.perf.ts` is never matched by `npm run test`): default 168×112 world builds in ~18 ms and runs at 13–16 ms/tick with a warm population of ~3200 — the UI budget at 10 ticks/s is <100 ms/tick shared with rendering; 48×48 test world at its 500-creature ceiling ~1.4 ms/tick; save/restore ~4 ms. Limits are floors (~3–30× headroom), so a red perf test means an algorithmic blow-up. E2E: `playwright.config.ts` + `e2e/app.e2e.ts` drive the real app against the real engine on a dedicated dev-server port: readout reflects the world, Step advances exactly one tick per click, Run/Pause control the loop, seed input creates a world with that seed and resets the tick. `npm run test:perf` → 3/3 pass; `npm run test:e2e` → 4/4 pass; unit suite and `npm run build` remain green |

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
src/sim/config.ts     `defaultConfig()`, scenario presets (`SCENARIOS`), population ceiling
                      (`POPULATION_CAP_LIMITS`, `clampPopulationCap`, `setPopulationCap`), predation
                      (`PredationConfig`, `MIN_PREY_ENERGY_LIMITS`, `clampMinPreyEnergy`,
                      `setMinPreyEnergy`; assimilation base `ASSIMILATION_BASE_LIMITS`,
                      `clampAssimilationBase`, `setAssimilationBase`; juvenile plant allowance
                      `JUVENILE_PLANT_ALLOWANCE_LIMITS`, `clampJuvenilePlantAllowance`,
                      `setJuvenilePlantAllowance`)
src/sim/types.ts      shared types, behaviour constants, `DEATH_CAUSES`, `dietClassOf`
src/sim/engine.ts     the step function, `EnergyLedger`, `auditEnergy()`, event log, census history,
                      `toState()` / `fromState()` with `SIM_STATE_VERSION`, `CHART_FIELDS`

src/main.ts           mounts `src/App.vue` into `index.html`
src/env.d.ts          Vue SFC module declaration
src/store.ts          owns the `Simulation` and the requestAnimationFrame loop (capped ticks per
                      frame); reactive `ui` control state only (running / speed / map view / selected
                      species / `frame`), `getSim()`, `stepOnce`, `newWorld`, scenario + speed presets,
                      the live population cap (`setPopulationCap` / `resetPopulationCap`) and the predation
                      controls (`setMinPreyEnergy` / `resetMinPreyEnergy`, `setAssimilationBase` /
                      `resetAssimilationBase`, `setJuvenilePlantAllowance` /
                      `resetJuvenilePlantAllowance`)
src/App.vue           app shell; starts the loop on mount, stops it on unmount
src/ui/ControlBar.vue run/pause/step, speed select, seed + new world, scenario presets, map-view
                      buttons, population cap, prey-energy-floor, meat-assimilation and juvenile-plant-
                      allowance fields, live tick/season/creature readout
src/render/WorldCanvas.vue  one-pixel-per-tile ImageData (terrain / biomass / temperature views)
                      upscaled to the display canvas, then creature dots; reads only, never writes
src/ui/StatsPanel.vue live census, diet-composition bars, trait averages, deaths by cause, the
                      energy audit with a drift indicator, population against the live ceiling
src/ui/ChartsPanel.vue canvas line charts from `sim.seriesSamples` over `CHART_FIELDS`
src/ui/SpeciesTable.vue species roster (lineage, abundance, peak, status), extinct species sharing a genus
                       collapsed into expandable group rows; rows select a species for
                      the map highlight
src/ui/EventLog.vue   newest-first event list

tests/helpers.ts             shared test config (`testConfig`: 48×48 world, 20 founders, cap 500),
                             `FOUNDER_COUNT` (derived from that config, so founder-id assertions in the tests
                             cannot drift from it) and the `runSim` helper
tests/conservation.test.ts   energy-cycle assertions over 1000 ticks (see §4)
tests/determinism.test.ts    same seed → identical state; different seeds diverge
tests/lineage.test.ts        inheritance/mutation bounds + engine genealogy assertions
tests/min-prey-energy.test.ts the quarry-energy floor as a knob: default equals the engine's original gate,
                             bounds, normalize parity, and the live-config and store wiring (§3)
tests/assimilation-base.test.ts the gut constant as a knob: default equals the engine's original
                             `0.45 + 0.45 · digest`, bounds, normalize parity, ledger still closed with
                             the knob moved mid-run, same-seed parity with the original constant, and the
                             store wiring (§3)
tests/population.test.ts     census bookkeeping: schedule, diet partitioning, birth/death accounting
tests/population-cap.test.ts the population ceiling as a knob: bounds, live ceiling changes without
                             restarting a world, newWorld carry-over (§3)
tests/physiology.test.ts     founder-archetype probe; runs (vitest)
tests/scratch.test.ts        food-web cohort probe; rebuilt and runs (see §7)
tests/scratch-pursuit.ts     diagnostic: per-hunt-episode results; run with `npx vite-node`
tests/scratch-population.ts  diagnostic: population trajectory against the ceiling; run with `npx vite-node`
tests/scratch-audit.ts       diagnostic: energy ledger vs population trajectory; run with `npx vite-node`
tests/scratch-founder-thermal.ts     diagnostic: what temperature the founder band is actually exposed to;
                                     `npx vite-node`
tests/scratch-founder-ratio.ts       diagnostic: founder loading ratio on the default world; `npx vite-node`
tests/scratch-testconfig-ratio.ts    diagnostic: the same ratio question on the 48×48 test configuration;
                                     `npx vite-node`
tests/scratch-late-introduction.ts   diagnostic: carnivores introduced into an established producer world;
                                     `npx vite-node`
tests/scratch-recruitment-scan.ts    diagnostic: which links of the carnivore recruitment chain each of 12
                                     seeds reaches at 3000 ticks, both allowance arms; writes its report to
                                     `.dev/recruitment-scan.txt`, which is git-ignored (`npx vite-node`)
tests/scratch-jpa-probe.ts           diagnostic: the default-world band censuses the knob's behavioural
                                      test asserts on, both arms in lockstep (`npx vite-node`)
tests/juvenile-plant-allowance.test.ts the (m) allowance as a knob: default equals the committed rule,
                                      bounds, normalize parity, run-parity against both engine anchors, and
                                      the two default-world arms observable apart (§3)
```

The sim modules import each other directly and save/restore lives inside `engine.ts`
(`toState()` / `fromState()`, `SIM_STATE_VERSION`). The interface consumes that public API as it is;
the only engine change it needed was exporting `CHART_FIELDS` for the chart field picker.

---

## 3. The interface (milestone 4, done)

The pieces §3 used to list as missing are written and verified live:

1. `src/main.ts` + `src/store.ts` — the app entry, and a store that owns the `Simulation` and a
   bounded `requestAnimationFrame` loop (`MAX_TICKS_PER_FRAME` caps a frame's work; speed presets
   2–10 t/s; pause / single-step). The `Simulation` instance is deliberately **not** made reactive;
   components read it through `getSim()` and redraw when `ui.frame` / `ui.epoch` advance.
2. `src/App.vue` + `ControlBar` — play/pause/step, speed, seed + new world, the `SCENARIOS` presets, and the manual population cap, minimum prey energy, meat assimilation, and juvenile plant allowance fields described below.
3. `src/render/WorldCanvas.vue` — a renderer that only *reads*: terrain/biomass/temperature from
   `world`'s tile arrays into an ImageData buffer upscaled to the display canvas, creature dots on
   top, species highlight on selection. It never writes simulation state.
4. `StatsPanel` / `ChartsPanel` / `SpeciesTable` / `EventLog` — fed by `sim.lastCensus`,
   `sim.seriesSamples`, `auditEnergy()`, `sim.species` and `sim.events`.

Verified against the dev server (`npm run dev`, http://localhost:5173): clicking Run advances the tick
readout (measured 3296 → 3356 over 5 s), the season and creature counts update, the world canvas
paints terrain and creatures, the census/species panels populate. `vue-tsc` is clean over the UI and
`npm run test` stays green. Visual polish (layout, palette, minimap) is deferred.

**Manual population cap (added after milestone 4).** `src/sim/config.ts` now exports
`POPULATION_CAP_LIMITS` (20–4000), `clampPopulationCap(value)` and `setPopulationCap(config, value)`, which
clamps and returns the ceiling actually applied; `normalizeConfig` clamps through the same function.
`src/store.ts` mirrors the live `config.population.maxCreatures` in `ui.populationCap` and exports
`setPopulationCap(value)` / `resetPopulationCap()`; `newWorld` carries the chosen cap over to the new world,
the same way it carries the selected scenario. The ControlBar gained a "Population cap" number field (min/max
from the limits, step 10, with a Default button) and both readouts show `population / cap`.

The engine only consults the ceiling where a birth would be added, so a change takes effect on the next tick
of a running world: it is a brake on breeding, not a cull — a population above a newly lowered ceiling simply
cannot breed until ordinary deaths bring it back under. Measured with `tests/scratch-cap-probe.ts` on the
48×48 fixture (starting cap 500, 2000 ticks, population sampled every 100 ticks):

| seed | change | measured result |
|---|---|---|
| `probe-a` | cap 500 → 150 at t=400 | 177 at t=300, 152 at t=400, then held at 150–152 for the remaining 1600 ticks |
| `probe-a` | cap 500 → 60 at t=800 | 502 at t=700, then 474 → 440 → 396 → 350 → 302 (t=800…1200): the excess dies off, nothing is culled |
| `probe-a` | cap raised back to 500 at t=1300 | 302 at t=1200, 501 at t=1300 and stable to t=2000: breeding resumes with no restart |
| `probe-b` | the same two changes | 133 at t=400 (already under the new ceiling) then 150–153 for the rest; 458 → 212 after the second change; 494–502 after the raise |

`tests/population-cap.test.ts` (6 tests) covers the clamping (including NaN and fractional input), applying a
lowered and a raised ceiling to a running world without restarting it, and the store wiring.

Verified live in the running UI: entering `100` showed `144 / 100 creatures`; `9999` was clamped to 4000 and `5`
to 20. With the ceiling at 20 the 144 founders were not culled — the count fell to 76 by tick 72 and to 0 by
tick 3189, and nothing was removed when the ceiling was lowered. "Default" restored 3200, and "New world" then
built a fresh world at `144 / 3200`.

**Quarry-energy floor ("Prey energy floor", added after milestone 9).** The engine has always refused a quarry
whose body energy sits at or below `0.2` — the gate §5 and §6E have referred to as `energy > 0.2`. That number is
now `config.predation.minPreyEnergy` (`src/sim/config.ts`), with `MIN_PREY_ENERGY_LIMITS` (0–0.9),
`clampMinPreyEnergy(value)` and `setMinPreyEnergy(config, value)` which clamps and returns the floor
actually applied; `normalizeConfig` clamps through the same function and back-fills `0.2` for a saved config or
snapshot that predates the `predation` section, so old saves restore the engine's original gate rather than an
undefined one. `src/store.ts` mirrors it in `ui.minPreyEnergy` and exports `setMinPreyEnergy(value)` /
`resetMinPreyEnergy()`; `newWorld` carries the chosen floor over to the new world the way it carries the scenario
and the cap. The ControlBar field takes min/max from the limits with step 0.05 and a Default button that restores
0.2. The default is the old constant, so no default world behaves differently from before this change.

Unlike the cap, this one is read on every tick rather than only at a breeding decision: `preyIsLegal`
(`src/sim/engine.ts:830`) now reads `o.energy > this.config.predation.minPreyEnergy`, so raising it takes effect
on the next tick of a running world and takes it away again when it is lowered. It changes *which animals count as
legal quarry* — it never removes or culls a living animal — and it is a separate gate from `pursuitIsWorthwhile`,
which decides whether a legal quarry is worth the walking cost. Raising the floor therefore narrows a band's prey
to well-fed adults; lowering it below 0.2 opens chases of animals carrying thin reserves, which is exactly the
population state §6E says has never been measured. `tests/min-prey-energy.test.ts` (6 tests) covers the clamping
(upper and lower bounds, fractional input, NaN), that the UI control and `normalizeConfig` clamp identically, that
a config with no `predation` section restores 0.2, that the floor can be raised and lowered on a world already
running without restarting it, and the store wiring.

Verified live in the running UI: the field renders as a spinner on the control bar, setting it moves
`ui.minPreyEnergy` and `sim.config.predation.minPreyEnergy` together, out-of-range and empty (NaN) input lands on
the bound rather than corrupting the config, Default restores 0.2, and the app runs with no console errors. A
measured ecology run at raised floors is the §6E experiment itself and has not been run yet; §6E closes by naming
what such a scan would settle.

**Meat assimilation (added after the quarry-floor control).** The other side of the predation budget — how much
of a kill a predator's gut actually absorbs — was hard-coded in the engine as `0.45 + 0.45 · digest`, written
out in two places (`attack` and the payoff estimate that prices a chase). It is now
`config.predation.assimilationBase` (`src/sim/config.ts`), read through one engine helper,
`assimilationRate(c)`, which pays `assimilationBase · (1 + digest)` capped at 1.0: absorption is never more
than the prey's body held, and what the gut does not take still falls to litter where the prey fell, exactly
as before. `ASSIMILATION_BASE_LIMITS` (0–0.9), `clampAssimilationBase(value)` and
`setAssimilationBase(config, value)` mirror the quarry-floor functions; `normalizeConfig` clamps through the
same function and back-fills `0.45` for a saved config or snapshot that predates the key, so old saves
restore the engine's original gate rather than an undefined one. The default 0.45 reproduces the old constant
exactly, so no measured result changes. `src/store.ts` mirrors it in `ui.assimilationBase` and exports
`setAssimilationBase(value)` / `resetAssimilationBase()`; `newWorld` carries the chosen value over to the new
world the way it carries the scenario and the cap. The ControlBar field takes min/max from the limits with
step 0.05 and a Default button that restores 0.45. The rate is read every tick — it prices
`pursuitIsWorthwhile`'s payoff and pays the kill itself — so raising it concentrates profitable hunting on
well-fed quarry and lowering it opens the thin-reserve prey on the intake side; the absorption cap keeps the
energy ledger closed at every knob position. `tests/assimilation-base.test.ts` (7 tests) covers the default
matching the engine constant, the clamping (bounds and NaN), that the UI control and `normalizeConfig` clamp
identically, back-filling 0.45 for configs missing the `predation` section or holding only the older floor
key, the knob taking effect mid-run on a live world with the energy audit still closed at both extremes, run
parity at the default with a moved knob observable in the same world, and the store wiring. Verified live in
the running UI: the field moves `ui.assimilationBase` and `sim.config.predation.assimilationBase` together,
out-of-range and empty (NaN) input land on the limits, and Default restores 0.45. An ecology scan across
knob positions — the intake-side counterpart of the §6E floor scan — has not been run yet.

**Juvenile plant allowance (added after candidate (m)).** The engine's candidate (m) lets a strict-carnivore
animal (diet > 0.66) eat plants until its own `maturityAge`: `juvenilePlantAllowance(c)` (`src/sim/engine.ts`)
returns a concession that is full at the band edge and scales down to a floor of 0.2 at full carnivory —
`max(0.2, 1 − (diet − 0.66) / 0.34)`. That base is now multiplied by `config.predation.juvenilePlantAllowance`
and the result capped at 1, in the same helper. `JUVENILE_PLANT_ALLOWANCE_LIMITS` (0–2),
`clampJuvenilePlantAllowance(value)` and `setJuvenilePlantAllowance(config, value)` mirror the other predation
knobs; `normalizeConfig` clamps through the same function and back-fills `1` for a saved config that predates
the key. The default 1 reproduces the committed rule exactly — every (m) measurement in §6 was made against
it — and 0 removes the concession entirely, the exact baseline arm those measurements compared against;
values above 1 widen every allowance branch toward the cap without touching the gradient the concession
scales along. The value is read at every animal's feeding decision each tick, so it takes effect on a
running world.

`src/store.ts` mirrors it in `ui.juvenilePlantAllowance` and exports `setJuvenilePlantAllowance(value)` /
`resetJuvenilePlantAllowance()`; `newWorld` carries the chosen value over to the new world the way it
carries the other predation controls. The ControlBar field takes min/max from the limits with step 0.1 and
a Default button restoring 1. `tests/juvenile-plant-allowance.test.ts` (10 tests) pins both anchors from
outside the engine: on the 48×48 fixture a world run at the default is the identical species ledger and
living roster of the same engine run with its allowance method replaced by the committed rule written out
in the test file, and a world run at 0 is the same world with that method replaced by a constant zero;
a 0.5 multiplier matches the scaled formula exactly, and at the maximum multiplier the concession is still
capped at 1 and still 0 outside the band or past maturity. The behavioural test runs the default world's two
arms in lockstep for 1000 ticks (seed `evolab-3`, the world the (m) A/B was measured on) and the
concession is what separates them: at 1000 ticks the arm with it still has living members of the strict
band and reached a higher peak count of band juveniles; the arm without it has none. Verified live in the
running UI: the field moves `ui.juvenilePlantAllowance` and `sim.config.predation.juvenilePlantAllowance`
together, 99 clamps to 2, Default restores 1, and the app runs with no console errors. An ecology run across
the intermediate knob positions has not been run yet.

**Species roster grouping (presentation only, added with the above).** Long extinction runs dominate the
roster: the default world had 1849 extinct species on the table when this was written, and successive
re-foundings of one lineage share a genus — the first word of the binomial, which `makeName` inherits from
the parent species. The roster now collapses extinct species by genus: a genus with two or more extinct
species renders as one row — `† Genus · N extinct species` with the diets present in the group, the highest
generation number reached, summed peak and lifetime-born counts, the earliest founding tick, and the tick the
genus last went quiet — and clicking it expands the ordinary per-species rows beneath it, each still
selectable for the map highlight. A genus with a single extinct species, and every living species, render
exactly as before. This is presentation only: `src/ui/SpeciesTable.vue` groups what `sim.species` already
reports, the expanded state is a local ref, and nothing in the engine or its saved state changed. Verified
live on the default world: the roster rendered 144 group rows covering all 1849 extinct species (the
largest, `Ferrusylv`, covering 336), and expanding one showed its 14 members with lineage and extinction
data. The chart picker's field select also gained the explicit "Chart metric" label it had been missing.

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

- **The cycle is now asserted, its internals are not.** `tests/conservation.test.ts` holds the full
  1000-tick energy audit to account (production, pool accounting, brood handover) within a float
  margin. What remains unaccounted is the *inside* of `lifeHeat`:
- **Metabolism, movement and thermoregulation are indistinguishable** inside `lifeHeat`, and the
  `releaseNutrients` return fraction is a constant rather than something derived or measured. An
  energy shortfall in an animal therefore cannot be attributed to a cause.
- **Meat and plants are not separated in the ledger.** Both raise `c.energy` through the same
  `digest`-weighted absorption (`0.45 + 0.45 × digest` on a kill, `digest` on a bite), so
  "carnivores are starving" and "there is no forage here" produce the same numbers.
- **`digest` scales both channels at once**, so raising it to help hunters also changes grazing —
  which is why §6 has to be measured before any change to it.

---

## 5. Open problems (as measured in this pass)

**Closed by this pass** (former items 1–3 and 7 of this section): both probes now run;
`npx vitest run` → 2 files pass; `npx vue-tsc --noEmit -p tsconfig.app.json` → clean; the §6
question is answered, with the measurements written there.

**Closed by the milestone-5 pass** (item 5 of this section): the engine now records offspring parents
in the lineage store (`makeCreature` accepted no parent ids before). `npm run test` → 6 files / 25
tests pass: conservation (1000-tick energy audit), determinism (same seed → identical state;
different seeds diverge), inheritance/mutation bounds, engine genealogy and census bookkeeping.

**Still open:**

1. **The carnivore diet band does not survive one generation.** Re-measured in this loop on the
   default world (168×112), three seeds, 3000 ticks: the band is **zero at the first census** in
   every run; all band deaths are starvation (no thermal, no predation). Successful kill rate is
   capped at 0.28–0.37 per carnivore per tick; intake 0.15–0.44/tick against a 0.21–0.54 need.
   Same-strategy target selection works (52% of attempts land); random selection lands 0 in 25.
   The answer is in §6A/§6B; the food-web route remains open.
   **Re-measured this loop under the founder changes recorded in §6D (candidates g and h).** The band now
   hunts and kills from the first tick: `npx vitest run tests/scratch.test.ts` on the default world reports
   **0.103 kills per animal-tick, 0.350 E of meat per animal-tick against 0.458 burnt**, 768 legal prey
   visible inside the band's own 8.0-tile senses, nearest legal prey at 0.0 tiles — every one of the 6
   founder carnivores can see something it is allowed to eat. It is still net **−0.111 E per tick** and the
   founder cohort is gone by the end of the first window (4 starvation, 2 thermal deaths). So the band's
   problem is no longer contact, price or distance: it is that a strict meat-eater's bill exceeds what this
   prey density pays it, and no offspring survive the gap (§6B, gate 1).
   **Re-measured a third time, under candidate (m)'s allowance (§6D).** The plant half of that gap is
   closed: a strict-diet band's own young may now graze, and on `evolab-3` the band is alive at every
   census from tick 250 and ends the run with 11 adult strict-heritage animals. What is still open is the
   other half of the same sentence — on `evolab` and `evolab-2` the founding cohort dies before it has a
   juvenile for that rule to act on, and no seed but `evolab-3` carries a band to the 3000-tick census.
2. **The population ceiling, not ecology, is what regulates numbers.** Same trace: the herd fills
   `maxCreatures` (3200) by ~tick 750 and stays pinned exactly there for the remaining 5000+
   ticks while vegetation stays healthy. Raising the ceiling to 12000 does not find a stable
   carrying capacity either — it produces overgrazing boom-and-bust (§6C). A hard design limit was
   added so no run can outrun its intended size: `normalizeConfig` now clamps `maxCreatures` to
   **4000** (was 20000); the default stays 3200.
   **First exception measured this loop.** Under the founder ratio §6D candidate h (120/18/6) on seed
   `evolab-3`, the population is **not** pinned at the ceiling: it leaves 3182–3200 and settles at
   2814–2939 for the last 1250 ticks, with **6837 predation deaths** over the run and 219/338/6837
   predation deaths across the three tested variants of that ratio. That is the first measurement in this
   project where predators, not the cap, move the number. §6D candidate (r) has since measured it on 12 seeds:
   on the (m) arm 11 of 12 seeds peak at 3195–3201 and 5 of 12 sit at 3200 at a census, while
   `evolab-3` peaks at 3063 with the ceiling never reached (16,782 predation deaths doing the work), and
   `evolab-10` on the (m)-off arm peaks at 2967 with 4,910 predation deaths. The exception is real and
   repeatable — predators move the number where a band is strong — but on the (m) arm it holds on one
   seed of twelve, so the bar in §8 step 4 is still unmet.
3. ~~`npm run test:perf` and `npm run test:all` cannot run: `vitest.perf.config.ts` does not
   exist.~~ Closed by milestone 6: the perf runner and `tests/perf/engine.perf.ts` exist; 3 benchmarks
   pass (baselines recorded in §10).
4. ~~`npm run test:e2e` cannot run: `playwright` is not installed.~~ Closed by milestone 6:
   `@playwright/test` is installed, `playwright.config.ts` + `e2e/app.e2e.ts` exist; 4 browser tests
   pass against the real dev server. `test-results/` and `playwright-report/` are gitignored.
5. ~~No test asserts core simulation behaviour.~~ Closed by the milestone-5 pass (see above). What is
   *not* yet asserted is the ecology outcome the tests were built to track: no test can show a
   persisting predator cohort or an un-capped population, because neither exists yet (items 1–2).

---

## 6. The carnivore question — answered this pass

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
  `herbivore 0.34 / carnivore 0.5`, sprint speed `herbivore 1.15 / carnivore 1.8` and metabolic
  rate `herbivore 0.9 / carnivore 1.15`. The starting carnivores are strict meat-eaters with the
  highest metabolic bill in the population.

**Answer (this pass).** The question turns out to have two halves, and the measurements separate
them cleanly.

**A. The founder cohort: the chase and the kill work; the founders never get near legal prey.**
From the cohort probe (`tests/scratch.test.ts`) and the per-episode diagnostic
(`tests/scratch-pursuit.ts`):

- Carnivore founders spawn scattered by `findSpawn`, frequently on tiles where no legal prey is
  visible at all; the nearest legal prey is tens of tiles away while the energy grace period is
  ~35–45 ticks.
- Once a hunter reached a quarry, kills usually landed: 37 of 52 tracked chase episodes ended in a
  kill within 2–3 attacks at ~1 tile, and wounded prey that rested were finished off. 11 episodes
  ended with the hunter dying mid-pursuit. The pursuit-and-kill machinery is not the failure;
  **first contact is**.
- Engine changes made and measured through the probe during this work (kept in the code):

  | Change | Measured effect |
  |---|---|
  | Quarry commitment (`pickQuarry` / `huntTarget`: keep one quarry until it dies, goes illegal, or leaves `senseRadius × 1.5`) | Kills per episode rose sharply; before this, quarry re-selection every tick meant pursuit never converged |
  | Carnivore founder speed raised to 1.8 | Intake per carnivore ×10 (~0.011 → ~0.107 per tick) — still ~4× below their ~0.44/tick bill; extinction by ~tick 100 |
  | Flight-initiation distance 3 tiles (`FLEE_INITIATION_DISTANCE`) | Little effect; kill cycles stayed 40–43 ticks |

- **Clustered founder spawning — implemented this loop, and it fixed its own precondition without
  fixing the cohort.** Founders are spawned around fertile cores with a ring per diet band
  (`engine.ts` ~line 257: `founderRing` herbivore 10 / omnivore 8 / carnivore 15, via
  `world.findSpawnNear`). Measured with the new probe `tests/scratch-founder-prey-visibility.ts` on
  the default world (168×112), three seeds, at t=0: every founder carnivore now has legal prey in
  range — 0–53 legal prey visible, nearest legal quarry 0–6 tiles (0–2 on seed `evolab`). §6A's original cause
  (founders never reach legal prey) is therefore **closed as a cause**; the band still goes to zero
  at the first census, so the binding constraint is not contact but the energy flow from a kill
  (see §6D). The change is kept: it fixed the precondition it was written for.

**B. Why no new carnivore ever appears.** The 6000-tick traces (both ceilings) show the same
thing: predation deaths are exactly 0 from tick 500 onward; at most 1–6 of 12000 animals ever sit
in the 0.2–0.66 diet band; mean genome diet *falls* from 0.08 to 0.05. Three engine rules make
carnivory un-recolonizable:

1. Hunting is only selected at `ph.diet ≥ 0.6` (starving), `> 0.66` (hungry), or a 50/50 coin
   flip between (engine.ts 533–540); and `behaveHunt` forages instead of hunting below 0.2
   (engine.ts 782). An animal at the population's mean diet never hunts at all.
2. Legal prey must be a **different species**, smaller than `hunter.mass × (0.35 + 1.7 × diet)`,
   and carrying energy above the quarry-energy floor (`preyIsLegal`, engine.ts ~824–831; the floor is
   `config.predation.minPreyEnergy`, 0.2 at the default and every recorded measurement, and §3's "Prey
   energy floor" field is that value made live). When one herbivore lineage
   covers every fertile tile, neighbours are conspecifics, and the cross-species juveniles that
   do exist are usually too thin (`energy > 0.2`) to be legal quarry.
3. Fear works the same way: predator detection requires animals with `diet > 0.34` and
   `mass > 1.2 ×` the prey (engine.ts 525). Once the carnivore band is gone, no animal ever flees.

So a carnivorous mutant pays the strict-meat-eater costs and can gain nothing: carnivore
extinction is an absorbing state. Keeping the founder bands alive (A) is the lever; raising
`digest` is not.

**C. Carrying capacity: the ceiling is currently what holds the world up.** Measured on the
default world (168×112, seed `evolab`):

- Ceiling 3200: population fills it by ~tick 750 and stays pinned at exactly 3200 for 5000+
  further ticks while mean land vegetation stays healthy (1.5–3.4). Deaths balance births at
  ~1000–1300 per 250 ticks: old age ~200–900, starvation ~180–450, disease ~100–430, thermal
  stress ~20–1300 per window.
- Ceiling 12000: no stable lower carrying capacity emerges. Overgrazing boom-and-bust: population
  4.3k → 6k → crash (12k–16k starvation deaths per 250-tick window) → 10–12k again; mean land
  vegetation collapses from 5.1 to 0.06–0.09. Speciation bookkeeping explodes (500+ species
  records).
- Thermal stress is a top-three cause of death at every scale: founder thermal optima (20–22 °C)
  face an equator at 26 °C with ±9 °C seasons.

Conclusion: a stable population of a few thousand is **not** what this environment produces on its
own at default primary productivity — it is what the ceiling imposes. The guardrail was tightened
to match the design: `normalizeConfig` clamps `maxCreatures` to 4000. The right fix is to make
ecology the regulator, top-down: keep predators alive (A/B) first, re-measure, and only then, if
K still sits at the ceiling, lower primary productivity rather than raise the ceiling. Candidate (k)
has since measured exactly that prescription, and it came back inverted: with the cap held, lowering
primary productivity either left the population pinned at the cap or broke the founding community —
it produced no stable community under the cap (§6D candidate k).

**D. Candidate records for this loop (measured).** Each candidate below was measured with the probes
in §7 on the default world (168×112), seeds `evolab`, `evolab-2`, `evolab-3`, 3000 ticks, census
every 250 ticks. The engine was not changed for a candidate until the candidate produced a result.

| Candidate | Measured result | Verdict |
|---|---|---|
| Clustered founder spawning (rings 10/8/15 around a fertile core, `engine.ts` ~258) | Founder bands now see legal prey at t=0 (0–53 legal prey visible per founder, nearest legal quarry 0–6 tiles, most 0–2). Carnivore band still **0 at the first census** on all three seeds | **Kept.** It fixed the contact failure it was written for; it does not by itself keep the band alive |
| Founder metabolic load 1.15 → 0.8 (`traits.ts`, `metabolism.founders.carnivore`) | Identical outcome: founder band 0 at the first census, carnivore band 0 at every census, on all three seeds. Whole-world death tallies *worsened* (seed `evolab`: starvation 2895 → 4073, thermal 1517 → 2108). Final population 3196/3190 and 3200/3196 — the ceiling, not the band, sets the number | **Rejected** (not committed) |
| (d) **The meat a strict carnivore can reach** (`tests/scratch-meat-supply.ts`, engine unchanged) | **0.00 legal animals inside the cohort's own senses** (radius 7.6–8.5 tiles) at every scan, both seeds; the nearest animal this cohort is allowed to eat is **6.6–8.7 tiles away**. The cohort's whole life: 0.229–0.251 E of meat per animal-tick against 0.352–0.371 burnt, plant 0.0000, reserves 11.9 → 0.0, all 12 founders dead inside the first 250-tick window | **Measured, no engine change kept.** The failure is distance, not price |
| (d) **Scavenging the world's litter** — a scavenge branch of `behaveHunt` (walk to the richest litter in sight, call `World.takeDetritus`); implemented, measured, **reverted** | Given that food the band drew **99.7 E in 530 feedings** at `evolab` (42.3 E at `evolab-2`; 18.0 E and 13.5 E in the two 48×48 runs) = **0.035–0.08 E per carnivore-tick**, against a pool that grows 186 → 6,108 E within 250 ticks while a founder stands on 0.54–0.69 E per animal-tick. The band was still **0 at the first census and at every census afterwards, pool open or closed**: final population 3199 open vs 3199 closed at `evolab`, 0 vs 0 at `evolab-2` | **Rejected**: it pays 0.04–0.08 E per carnivore-tick against a 0.35–0.37 E bill. Reverted |
| **Candidate (f): founder thermal adaptation** — give the founders a thermal band matched to the world they spawn into (`tests/scratch-founder-thermal.ts`, no engine change) | Spawn temperature against the founders' own optimum: mean deviation **3.5–5.1 °C**, maximum 6.5 °C, against a 10–12 °C tolerance window — inside the band, not outside it. Every founder-band death in the sampled windows was **starvation (12/12)**; **0 thermal deaths** in any founder window. Thermal stress is a real whole-population regulator (100–310 deaths per 250-tick window), just not this one | **Rejected before any engine change.** Temperature adds to the bill but is not what kills the band. The probe is kept so the exclusion can be re-checked |
| **Candidate (g): herd-anchored founder spawning** — carnivores spawn 1–2 tiles from a producer founder instead of on a ring at radius 15 (`engine.ts` ~250–283) | First contact is real from tick 1: **0.060–0.064 successful kills per animal-tick**, **0.347 E gross prey-body intake per animal-tick** against a 0.352–0.371 E bill (`tests/scratch-meat-supply.ts` re-run). The founder band still dies within the first window on 2 of 3 seeds, and survives to tick 500 on one | **Kept.** It removed the distance failure candidate (d) named, and moved the binding constraint from *contact* to *overharvest* — which is what candidate (h) then measured |
| **Candidate (h): founder loading ratio** — `config.population.founders` only, no behavioural change (`tests/scratch-founder-ratio.ts`: 5 variants × 3 seeds × 3000 ticks) | 60/18/12 (the old default): seed `evolab-2` ends at **population 0**. 60/18/6: `evolab-2` ends at 0. 120/18/12: no collapse, band gone by tick 500. **120/18/6**: no collapse on any seed, a band present at ticks 250–500 on two seeds and **alive at the 3000-tick census on `evolab-3`**, predation 172/165/6837 per run, and on that seed the population sits **below the ceiling** (2814–2939) for the final 1250 ticks. 60/18/4: no collapse on any seed, `evolab-2` recovers to 3100, but the band reaches 3000 on one seed only and predation is lower (55–801) | **Kept, and it is the new default: 120/18/6** (`config.ts`). The first configuration in which predation, not the cap, moves the population |
| **Candidate (i): carnivores introduced into an established world** (`tests/scratch-late-introduction.ts`: 12 founders injected at tick 1500, nothing else changed) | `evolab-3`: **7–16 carnivores at every census for the whole 1500-tick observation.** `evolab-2`: overshoots to 36 then crashes to 0. `evolab`: dead within ~500 ticks — that equilibrium is crowded and its adults are thin (`preyIsLegal` requires prey energy > 0.2) | **Measured, no engine change kept.** Strict carnivory *is* supported at equilibrium where well-fed adult prey exist; what fails is the cold start, not the diet |
| **Candidate (j): recruitment-quota predation on juvenile prey** — `preyIsLegal` exception: an animal below its own `maturityAge` is legal quarry only while its own species is growing, the allowance (`quarryQuota`, recomputed at every census from the growth that census recorded, capped at one kill per animal the species already has) being the growth itself. Implemented in `engine.ts`, measured A/B on identical seeds with `tests/scratch-carnivore-quota.ts` | The rule engages and it changes what is eaten: juvenile kills **49 / 10 / 747** where the standing rule records **0 / 0 / 0**, adult kills fall **338 → 168, 161 → 157, 6837 → 3793**. On `evolab-3` it produces the largest mid-run band this project has measured — **26–28 animals at ticks 750–1250** — and then loses it: **0 from tick 2000**. Strict band at the 3000-tick census: **0 / 0 / 0**, against **0 / 0 / 11** with the rule off on the same seeds. No seed collapses (3196 / 3192 / 3198), and mature prey are plentiful throughout (≈2900) | **Rejected; the engine change is reverted.** It is the first candidate that made a carnivore band *bigger*, and that is what makes it informative: the band was never short of food or of quarry, it over-shoots, the population sits back on the 3200 ceiling from tick 1750, and the band is gone 250 ticks later. The one configuration that reaches 3000 under the standing rule is the one where the population stays **under** the cap — which is the reading candidate (h) already gave, and it points at §8 step 3.j, not at another behavioural gate |
| **Candidate (k): lower primary productivity, cap held fixed** — `environment.sunlight` ladder 1.00 → 0.85 → 0.70 → 0.55 plus a famine-level preset (0.42 sunlight / 0.62 rainfall), `maxCreatures` unchanged at 3200 (`tests/scratch-productivity-ladder.ts`: 5 rungs × seeds `evolab`, `evolab-2`, `evolab-3` × 3000 ticks, no engine change) | The baseline rung reproduces candidate (h) exactly — band 11 at the 3000-tick census on `evolab-3`, 0 on the other two seeds — the probe measures the same engine. The lowered rungs do **not** move the population off the ceiling: every seed that survives peaks at 3189–3201 and sits capped for 6–9 of its 9 post-bootstrap censuses. What lowering productivity changes is the bootstrap, not the ceiling: `evolab-2` dies out entirely at rungs 0.70 and 0.55 (peaks 0 and 5), while `evolab` and `evolab-3` still reach the cap. The band is the first casualty: **0/3 seeds carry a strict band at 3000 on any lowered rung** — at sun 0.85 the `evolab-3` band that survives at default productivity is gone by tick 750. The only rung that never touches the cap is the famine preset (no capped census on any seed), and it is a broken world: `evolab` and `evolab-2` end at population 0, `evolab-3` crawls 55 → 2105 over 3000 ticks with **zero strict animals at every census** | **Rejected, no engine or config change.** A sub-cap community and a surviving band are anti-correlated in this engine: every configuration that can carry a band fills the cap, and the only configuration that stays under it cannot bootstrap a founding community at all |
| **Candidate (l): pack hunting — a pack widens its own prey-mass window** — a strict carnivore (`diet > 0.66`) with mature conspecifics in sight hunts as a pack: a new `packHuntBonus` counts up to 3 mature same-species bandmates inside its own senses and scales the `preyIsLegal` mass window by `1 + 0.35 × sociality × packmates`, `sociality` being the engine's existing heritable social trait (founder carnivores 0.35); a solitary or unsocial hunter keeps exactly the solo rule. Implemented in `engine.ts` (`preyIsLegal` / `pickQuarry`), measured A/B on identical seeds with `tests/scratch-pack-hunt.ts`, the pack arm patching the rule onto the committed engine at runtime | The rule fires on every seed — max window factor **1.52 / 1.69 / 1.66** — and opens nothing: quarry picks on prey above the solo window **0 / 0 / 1** across the six runs, kills on prey above the solo window **0 / 0 / 0**. §6B's "too big to be prey: 0" was not predation failing a size test; it is the true state of these faunas — the engine never declines a prey for size, because it never meets one outside its own window. Band at the 3000-tick census: **0 / 0 / 7** against **0 / 0 / 11** with the rule off on the same seeds: the `evolab` and `evolab-2` runs are identical, and the one seed where a band reaches 3000 ends with a smaller band (11 → 7, population 3198 → 3191, predation 6837 → 6829) | **Rejected; the engine change was reverted.** A pack changes what predation may eat, and in these worlds nothing is declined for size, so there is nothing for it to unlock. That closes §6B's size asymmetry as a lever. The binding constraint stays where (h) left it — the founder cohort's energy flow and the recruitment gap (no plant channel for a strict diet, offspring not surviving the founding overharvest) — not which prey is legal quarry |
| **Candidate (m): juvenile plant allowance for strict carnivores** — new gate `juvenilePlantAllowance(c)` in `engine.ts`: 0 for adults and for inherited diet ≤ 0.66; for an animal in the band below `maturityAge` it returns `max(0.2, 1 − (diet − 0.66) / 0.34)` — full at the carnivore boundary, falling to a floor of 0.2 at full carnivory. It is consulted at the engine's three existing plant-food decisions (a starving band juvenile with allowance ≥ 0.5 forages instead of hunting; a hungry band member draws foraging with exactly the allowance as probability; a band juvenile in `behaveHunt` with no legal prey falls back to grazing) and it scales the plant energy absorbed, so the channel has a cost the diet gene still prices; animals outside the band, and adults, behave exactly as in the committed engine. Measured A/B on identical seeds with `tests/scratch-juvenile-plant-allowance.ts`, the candidate switched off at runtime for the baseline arm | The baseline arm reproduces the recorded baseline — band 0 / 0 / 11 at 3000, populations 3198 / 3196 / 3198, predation 338 / 161 / 6837 — so the two arms differ by the rule alone. On `evolab-3` the band is alive at **every census from tick 250 to 3000**: peak **88 members (50 adult)** at tick 2750, run end **20 members (11 adult)**, inherited-diet census **[0.90+ 20], mean 0.965** — strict lineages, against the baseline's 11 members at mean 0.676 hugging the 0.66–0.70 edge. Band juvenile intake 419.9 E plants + 17,615.4 E meat; global predation 6837 → **16,782**; the world is no longer pinned at the 3200 ceiling — the population swings 281 → 3063 instead. But the band is leaky (202 adult and 240 recruit starvation deaths attributed), and on `evolab` and `evolab-2` it ends at zero members with **0 adult recruits all run on both arms** — the rule never acquires a subject there | **Kept; partial success, not accepted.** It is the first candidate in this loop to produce persisting carnivore lineages rather than census churn, and it closes the plant half of §6B gate 1 — but it holds on 1 of 3 seeds, and on the other two the founding cohort itself: on two seeds no animal ever reaches the age the rule applies to |
| **Candidate (n): sub-adult founders — `spawnFounder`'s `c.age = phenotype.maturityAge` replaced by `c.age = 0`** — the same six strict founders, the same genomes, the same starting positions and the same `maxAge`, but seeded as animals with 140–190 ticks of juvenile life ahead of them, i.e. inside the sub-adult band candidate (m) already protects, instead of arriving past it. Measured A/B on identical seeds with `tests/scratch-subadult-founders.ts`, the committed age stamp restored at runtime for the baseline arm | The baseline arm reproduces the committed engine exactly on all three seeds — band 0 / 0 / 20 at 3000, populations 3197 / 3191 / 2346, predation 601 / 151 / 16,782 — so the two arms differ by that one number. The head-start turns out to be load-bearing. With it the engine's strict founders produce **516 strict births** on `evolab-3` (first offspring at tick 31) and 1 and 6 on the other two seeds; the age-0 cohort produces **0 strict births on `evolab` and `evolab-2`** and **182 on `evolab-3`, first at tick 222** — 191 ticks later. Its band peaks at 51 members / 40 adults against the engine's 88 / 50, carries inherited diets averaging **0.869** against 0.965, and ends the run at **6 members** against 20; the founders die as juveniles (thermal stress and starvation before maturity) instead of as breeding adults. Every founder in both arms is dead by 3000 | **Rejected, no engine change.** The result inverts the hypothesis it was written to test. Seeding founders inside the protected window does not give the band a juvenile stage to feed on — it removes the only adult meat economy the strict cohort ever had: the engine's recruits exist because its founders killed as adults and their young then had the allowance to grow on. A cohort that cannot hunt as adults has nothing for its young to be weaned onto |
| **Candidate (o): price the chase gate with the engine's own prey-flight behaviour** — replace the two lines `pursuitIsWorthwhile` uses to model quarry flight ("flees at full speed if healthy and above 45% of reserve") with the flight behaviour the engine actually runs: a quarry is only threatened above the threat-mass ratio, only within the lesser of its sense radius and `FLEET_LIMIT`, runs only while its reserve stands above 0.45, and a quarry below 0.25 stands its ground instead of fleeing at 0.45. Implemented in `engine.ts`, measured A/B on identical seeds with `tests/scratch-pursuit-flight-gate.ts`, the committed gate reinstated on the instance for the baseline arm | The baseline arm reproduces the committed engine exactly on all three seeds — band 0 / 0 / 20 at 3000, populations 3197 / 3191 / 2346, predation 601 / 151 / 16,782 — so the two arms differ by the gate alone. The probe first prices the committed gate's refusals: **444 / 460 / 41,438 refusals, of which 72–90% were priced away by the flight model alone** — the bite would have covered the walk to a quarry standing still (`evolab-3` best such hunt: 10.6 energy at 8.5 tiles, walk cost 1.9) — while quarry at or above the hunter's own speed accounted for **0 / 0 / 182**: the flight model was almost never the reason a hunt was refused. Replacing it with the engine's real flight behaviour collapses refusals to **8 / 17 / 79** and opens those hunts — and the cohort is worse for it. Founders live shorter lives (cohort animal-ticks 977 → 809, 958 → 665, 2,442 → 624), the `evolab-3` band peaks at **19 members against 88** and ends at **15 against 20**, carrying inherited diets averaging **0.686 (13 of 15 inside 0.66–0.70)** against the baseline's **0.965 strict lineages**; `evolab` and `evolab-2` bands are dead on both arms. Band at the 3000-tick census: **0 / 0 / 15** — 1 of 3 seeds | **Rejected; the engine change was reverted.** The pricing artifact this candidate was written to remove turns out to be load-bearing: refusing hunts against "fleeing" quarry is what keeps founders out of marginal chases the whole hunt cannot pay for, and removing the refusals drains the founders faster and leaves a smaller, looser band. The chase gate is not the binding constraint — §8 step 3.j (founder energy flow and recruitment) is |
| **Candidate (p): carrion as meat the band can eat — kill leftovers held as carrion instead of sinking to litter** — a per-tile carrion pool in `world.ts` capped at `CARRION_MAX = 30` E and sinking into litter at `CARRION_SINK_RATE = 0.03` per tick, fed by the body mass a kill leaves uneaten (the leftover candidate (c) measured); a band animal whose `pickQuarry` returns nothing eats the carrion standing on **its own tile** at `0.45 + 0.45 · gutFill`. Implemented in `engine.ts` / `world.ts`, measured with `tests/scratch-carrion-scavenge.ts`, which runs a third arm in which natural-cause deaths (starvation, thermal stress, old age) feed the same pool; the committed engine is reinstated at runtime for the baseline arm | The baseline arm reproduces the committed engine exactly on all three seeds — band 0 / 0 / 20 at 3000, populations 3197 / 3191 / 2346, predation 601 / 151 / 16,782. With carrion from kills only the pool peaks at **4.5 / 1.1 / 6.6 E** and the band eats **2.6 / 1.6 / 2.5 E** on it, in **6 / 4 / 5 meals**, against 151.2 / 150.1 / 274.4 E deposited and 148.6 / 148.5 / 271.9 E sinking back to litter uneaten. Opening the pool to every natural-cause corpse makes it two hundred times larger — **161.7 + 32,203.9 / 265.1 + 28,665.4 / 608.3 + 38,109.6 E** in, peaks of **846.0 / 621.7 / 870.9 E**, 31,974.6 / 28,501.3 / 38,219.2 E sinking unused — and the band's intake barely moves: **2.6 / 3.3 / 4.6 E**. Band at the 3000-tick census: **0 / 0 / 0** on both carrion arms on all three seeds, against **0 / 0 / 20** with carrion off. What carrion does change is who gets eaten: predation falls 601 → 141, 151 → 149, 16,782 → 232 (155 / 321 / 714 on the corpse-fed arm); the `evolab-3` population that candidate (m) left oscillating 281–3063 sits back on the 3200 cap for the whole run, and its band's starvation deaths fall 8 → 5 as four members live to die of old age instead | **Rejected, no engine change kept.** The quantity of carrion is not what the band lacks: a pool peaking at 846–871 E bought intake of 2.6 → 4.6 E, because carrion is only reached by an animal that has already failed to find prey **and is standing on the carcass**. A meat source with no consumer that can find it behaves like the meat it replaced. What §6D candidate (c) left untested — whether a carnivore can *detect and walk to* a carcass — is the next candidate (§6D candidate q) |
| **Candidate (q): carrion a carnivore has to walk to — every food the animal can reach is priced** — a `behaveHunt` branch which, when `pickQuarry` returns nothing, scans the carrion standing inside the animal’s own perception and prices each candidate exactly as `pursuitIsWorthwhile` prices a live chase — the bite that animal can actually take, against the cost of the ticks its own speed needs to cross the distance — and walks to the best carcass whose walk pays for itself; implemented for measurement in `engine.ts` and run with `tests/scratch-carrion-walk.ts` against the candidate (p) feet-priced arm and the committed engine | The baseline arm reproduces the committed engine exactly on all three seeds — band 0 / 0 / 20 at 3000, populations 3197 / 3191 / 2346, predation 601 / 151 / 16,782. The walk rule is asked 504 / 822 / 1,170 times and walks **111 / 106 / 413** of them (22% / 13% / 35%); every refusal is priced — 393 / 716 / 757 refusals of walks that do not pay, 0 refusals for having no reserve. Carrion eaten rises from 26 meals on the feet-priced arm to **636** (111 / 109 / 416, of which 111 / 100 / 406 at walked-to carcasses) and band carrion intake from 2.6 / 3.3 / 4.6 E to **82.0 / 73.8 / 316.2 E**; the carrion pools stand at 314.0 / 366.8 / 440.7 E at 3000 (peaks 810.8 / 496.1 / 889.6 E) with 31,419.2 / 18,294.7 / 37,721.3 E sunk unused. Predation falls to 153 / 126 / 301; band at the 3000-tick census **0 / 0 / 0** on all three seeds (it appeared mid-run on 2 of 3 seeds, peaking at 1 / 0 / 2), no seed collapsed (populations 3194 / 3193 / 3196), against 0 / 0 / 20 with carrion off | **Rejected, no engine change kept.** The §6D bar — a strict-carnivore lineage present at the 3000-tick census on at least two seeds — is met on 0 of 3. With nothing left to refuse, walking to meat is worth taking only a quarter of the time it is offered, and reach is not the binding constraint either: the meat is reachable, affordable, and still does not found a population. The ground candidate (p) left untested is now measured; what remains is §6B gate 1 — the founding cohort’s energy flow and recruitment |

| **(r) Multi-seed recruitment scan — a measurement, not a candidate.** `tests/scratch-recruitment-scan.ts`: 12 seeds `evolab`, `evolab-2` … `evolab-12` × 3000 ticks on the committed engine, plus the same 12 seeds with `juvenilePlantAllowance` patched to return zero. Counts each link of the recruitment chain separately — the tick the founding strict cohort reaches zero and of what cause; whether a strict individual is ever born, and whether its parents were strict; whether any such recruit lived past its own `maturityAge` (read off the kill event, age against `phenotype.maturityAge` — no new engine rule); the band census at every 250 ticks; peak band adults; the inherited-diet spread at the final census | The two arms reproduce the two baselines already on file exactly: with (m) live, bands 0 / 0 / 20 on `evolab` / `evolab-2` / `evolab-3` (populations 3201 / 3199 / 3063, predation 601 / 151 / 16,782); with it patched off, 0 / 0 / 11 (predation 338 / 161 / 6,837). The scan instruments the runs without moving them. **Rates with candidate (m) live, 12 seeds:** a founder cohort that lasts — 0 / 12, every seed's cohort gone between ticks 198 and 1,044; a strict offspring born — **12 / 12**, every one of them from a strict parent, first at ticks 30–91; a recruit that lived to its own maturityAge — 10 / 12; a band at the 3000-tick census — **1 / 12**. **With (m) off:** strict births 12 / 12 seeds but 2–50 per seed rather than 516, recruits that matured 12 / 12, bands at 3000 on 2 / 12 — `evolab-3` at 11 members averaging **0.676** (every one inside 0.66–0.70) and `evolab-10` at 2 at mean 0.691 (whole-population mean 0.551), while the (m) arm's `evolab-3` band ends at 20 members averaging 0.965. On nine of the twelve seeds the band reaches adults and then dies out within 250–500 ticks of its own first competent adults (`evolab-6`: 19 members at 2250, gone by 2250+250; `evolab-8`: peak 23, gone by 2000), and the death ledger on those seeds is **starvation first** — 5 / 7 / 10 / 5 / 78 / 11 / 6 / 13 / 11 recruit starvation deaths per seed, against 0–12 old-age deaths and 0–2 predation deaths. Population ceiling: 11 of 12 seeds peak at 3189–3201, only `evolab-3` stays under it | **No candidate, no engine change.** What it establishes is where the chain breaks: recruitment is not rare (12 / 12 seeds produce strict young, 10 / 12 raise one to maturity), the loss is what happens **after** — a band that has reached adulthood and is then starved out inside a few hundred ticks, on a population that is sitting at the 3200 ceiling on every seed but one. (m) raises the number of carnivores a seed can hold (peak band adults 50 against 8 on `evolab-3`) but not the number of seeds that keep one (1 / 12 against 2 / 12). The raw per-seed record is at `.dev/recruitment-scan.txt`. |

**Candidate (d), measured: the meat a strict carnivore can reach** (`tests/scratch-meat-supply.ts`;
default world, seeds `evolab` and `evolab-2`, plus the same runs on the 48×48 test configuration;
250-tick windows to 3000 ticks; the animal's own gates, chase rule and energy bill, read through the
engine rather than recomputed). The cohort, in the window in which it dies:

| What was measured | Reading |
|---|---|
| legal prey inside the animal's own sensory radius (7.6–8.5 tiles) | **0.00 animals holding 0.0 energy**, in every scan, both seeds |
| what it is allowed to eat but cannot reach | 17 animals holding 102.9 E on `evolab`, 6 holding 20.6 E at `evolab-2`; the nearest one **6.6–8.7 tiles away** — outside the animal's senses, and outside its 2.3–2.4 tile strike range |
| what its own chase rule will commit to | **0.00 animals, 0.0 energy.** The most valuable hunt it would ever accept: none. The best hunt it refuses: a body holding 4.3 E, 6.6 tiles away, closing that gap costs 5.7 E, and hunting costs 0.54–0.66 E per hunting-tick |
| what the whole cohort ate | 0.229–0.251 E of meat per animal-tick, 0.0000 plant, against 0.352–0.371 burnt; reserves 11.9 → 0.0. The cohort (12 animals) is dead inside the first 250-tick window, on both seeds |
| the carrion alternative, implemented and measured | a `behaveHunt` branch walking to the richest litter pile in sight and calling `World.takeDetritus`: **99.7 E drawn in 530 feedings** (0.077 E per carnivore-tick at `evolab`, 0.035–0.095 E per carnivore-tick at `evolab-2`), out of the 7,000–8,388 E the cohort asked for. The band is 0 at the first census and at every census afterwards, **pool open or closed**, on both seeds: 3199 open vs 3199 closed at `evolab`, 0 vs 0 at `evolab-2` |
| the carrion that was available | a founder stands on 0.54–0.69 E of litter per animal-tick (richest single tile 5.8–6.6 E); the world's pool grows from 186 E to 9,861–11,854 E |

**Verdict: no engine change kept.** The carrion branch was implemented, measured, and removed; the engine
has no consumer of carrion again (`git diff` against HEAD is empty for `src/`). The measurement is what
matters: at this body size a strict carnivore never sees an animal it is allowed to eat, the animals it is
allowed to eat are 6.6–8.7 tiles away — further than its senses and far beyond its strike — and the food
that is actually under its feet pays 0.04–0.08 E per carnivore-tick against a bill of 1.18. So the
constraint is neither a price in the hunting formulas nor a missing food web: it is **distance**, and the
only distance the engine can honestly change at t = 0 is the founders' own reach. Candidate (e) in §8 is
the next measurement because the founders' thermal optimum (20–22 °C against a 26 °C baseline climate) is
already adding to exactly that bill, and thermal stress is a top-three cause of death in §6C.

**Candidates (f)–(j), the pass that followed it.** Six measurements, in the order they were taken;
(g) and (h) changed the engine and stayed, (j) changed it and was reverted.

- **(f) was ruled out before it was implemented.** The founders are not thermally exposed: spawned into a
  26 °C world with a 20–22 °C optimum and an 10–12 °C tolerance window, their spawn deviation is 3.5–5.1 °C
  — inside the band. Zero thermal deaths among founder bands; every founder death is starvation. Temperature
  is a population-wide regulator (100–310 deaths per window, and on `evolab` it rose to 3007 deaths over a
  3000-tick run), it is just not the cause the founder band dies of.
- **(g) removed the distance candidate (d) named, and exposed what was behind it.** Carnivore founders
  are now
  seeded one or two tiles from a producer founder (`engine.ts`: a `herdTiles` list of already-placed
  producer tiles is the anchor; the carnivore ring is 2, not 15). Kills land from the first tick —
  0.060–0.064 per animal-tick, 0.347 E gross prey-body intake against a 0.352–0.371 E bill — i.e. a
  founding herd that is huntable is eaten at almost exactly the rate the hunters must burn. **Overharvest**:
  the founders eat the founders out before the herd's first young reach maturityAge (90 ticks for a
  herbivore founder, while a carnivore founder must wait 140) and have no plant channel at diet 0.9 to fall
  back on.
- **(h) is the ratio that survives it.** `tests/scratch-founder-ratio.ts` measures five founder loadings on
  three seeds. A 60-animal herd cannot feed 12 strict carnivores: seed `evolab-2` ends at population 0 at
  both carnivore 12 and carnivore 6. A 120-animal herd survives either, and 120/18/6 is the loading where
  the predator band is still alive at the 3000-tick census and the population falls **below** the 3200
  ceiling on that seed (2814–2939 for the last 1250 ticks, 6837 predation deaths) — the first time in this
  project that predation, rather than the cap, sets the number. That ratio is now `defaultConfig()`.
- **(i) shows the cold start is the hard part, not the diet.** Injecting 12 carnivores into a world that
  has already reached its producer equilibrium keeps a band of 7–16 animals for the entire 1500-tick
  observation on `evolab-3`, an overshoot-and-crash on `evolab-2` (36 → 0), and a fast death on `evolab`,
  whose equilibrium is crowded and whose adults carry too little energy to be legal quarry. Carnivory is
  survivable at equilibrium; bootstrapping it is what fails.
- **(j) is the one candidate that made a carnivore band bigger, and it still failed.** `preyIsLegal` was the
  last gate that could plausibly starve a founding cohort: an animal below `maturityAge` was never quarry, no
  matter what the hunter could afford. Candidate (j) makes young animals legal exactly while their own species is
  growing — the allowance (`quarryQuota`) recomputed at every census from the growth that census actually
  recorded, capped at one kill per animal that species already has — so a declining population gets a quota of
  zero and the original rule back. Measured against itself, same seeds, same worlds: juvenile kills
  **49 / 10 / 747** where the standing rule records **0**, adult kills down **338 → 168, 161 → 157,
  6837 → 3793**, and on `evolab-3` a band of **26–28 animals at ticks 750–1250** — the largest mid-run band
  measured in this project — collapsing to **0 from tick 2000** and ending **0 / 0 / 0** at 3000 ticks against
  **0 / 0 / 11** with the rule off. No seed collapsed, and ~2900 mature prey were available throughout.
  Reverted. The band was never short of food or of quarry: it over-shoots, the population returns to the 3200
  ceiling, and the band dies in the crowd. The one run in which a band reaches 3000 under the standing rule is
  the one where the population sits **under** the cap — which is candidate (h)'s reading again, and it points at
  the ceiling and primary productivity (§8 step 3.k), not at another behavioural gate.

- **(k) tested the crowding explanation directly, and closed the ordered candidate list with a negative
  result.** The reading of (h) and (j) was the same: the band dies when the population sits at the 3200
  ceiling. So candidate (k) held the ceiling fixed at 3200 and turned down the two dials plant growth
  actually reads — `environment.sunlight` rungs 0.85 / 0.70 / 0.55, plus a `famine`-level preset at 0.42
  sunlight / 0.62 rainfall — on all three seeds, 3000 ticks (`tests/scratch-productivity-ladder.ts`; peak
  population, censuses at ≥ 99% of the cap from tick 1000 onward, band count at every census; no engine
  change).
  - **The baseline rung reproduces (h) exactly** — band 11 at the 3000-tick census on `evolab-3`, 0 on the
    other two seeds, populations 3190–3201. The probe is measuring the same engine.
  - **Lowering productivity does not move K off the ceiling.** At 0.85, 0.70 and 0.55 every seed that
    survives still peaks at 3198–3201 and sits capped for 6–9 of its 9 post-bootstrap censuses, exactly like
    the baseline; at rung 0.55 `evolab` merely takes until tick 1500 to reach it, and sits on it after that.
  - **What lowering productivity changes is the bootstrap, not the ceiling.** `evolab-2`'s founders never
    establish at 0.70 and 0.55 (peaks 0 and 5): a thinner grass base no longer survives the founding stage
    at 120/18/6.
  - **The band is the first thing lowered productivity removes.** At 0.85 the `evolab-3` band that reaches
    3000 at default productivity is gone by tick 750. At 0.70 and 0.55 a band shows up only as 1–3 animals
    at the earliest censuses and is 0 everywhere by tick 1000. Every lowered rung ends **0/3 seeds with a
    band at 3000**.
  - **The only configuration that stays under the cap is a broken world.** The famine preset never touches
    the cap on any seed (0 capped censuses) — and `evolab` and `evolab-2` end at population 0, while
    `evolab-3` crawls 55 → 2105 across 3000 ticks with **zero strict animals at every census**.

  **Conclusion: rejected; no engine or config change.** In this engine a community settled under the ceiling
  and a community carrying a carnivore band are anti-correlated: every configuration robust enough to carry a
  band fills the cap, and the only rung that stays under it cannot bootstrap founders at all. The barrier
  remains exactly where (h) and (j) left it — §6B: no plant channel for a strict diet, and no offspring line
  surviving the founding overharvest. **Measurement continued past (k): the candidates measured after it (l)-(q) are recorded in §6D, and the 12-seed scan (r) shows the default ratio meeting the acceptance bar on**;
  the only configuration that meets the acceptance bar anywhere is the default 120/18/6, and it meets it on
  1 seed of 12. Continuing is no longer a measurement question: it requires a new class of mechanism (§8).

- **(l) tested that new class — pack hunting — and it ruled out the size gate itself.**
  §6B's size refuge is the barrier no single predator can open: prey only has to stay above
  `hunter.mass × (0.35 + 1.7 × diet)` and predation cannot take it at all. Candidate (l) implemented
  the natural countermeasure — a strict carnivore (`diet > 0.66`) with mature same-species bandmates
  in sight scales that window by `1 + 0.35 × sociality × packmates`, up to 3 counted, scaling on the
  engine's existing heritable `sociality` trait so a lineage can evolve into pack hunting rather than
  being handed it. Measured A/B on identical seeds, the candidate patched onto the committed engine at
  runtime (`tests/scratch-pack-hunt.ts`): the rule fires on every seed — max factor **1.52 / 1.69 /
  1.66** — and opens nothing. Across all six runs: **1** quarry pick on prey above the solo window,
  **0** kills above it. The band at 3000 ticks comes out **0 / 0 / 7** where the solo rule leaves
  **0 / 0 / 11** — two seeds bit-identical, and the one seed carrying a band ends it smaller
  (population 3198 → 3191, predation 6837 → 6829). **Rejected; the engine change was reverted.** The
  finding is about §6B's gate, not about packs: "too big to be prey: 0" was never predation failing a
  size test — it is the true state of these faunas, in which every animal an engine predator meets
  already fits its own solo window. There is no size refuge to unlock, so no mechanism whose effect
  is to widen the window can move the band. The binding constraint stays where (h) and (j) left it —
  the founder cohort's own energy flow and the recruitment gap (§6B gate 1).

**(m) attacked that constraint directly, and split it.** The mechanism: `juvenilePlantAllowance(c)`
in `engine.ts` returns 0 for adults and for any animal with inherited diet ≤ 0.66, and for an animal in
the band below `maturityAge` it returns `max(0.2, 1 − (diet − 0.66) / 0.34)` — full allowance at the
carnivore boundary, falling to a floor of 0.2 at full carnivory. It is consulted at the three places
where the engine already decides whether an animal eats plants — the starving branch, the hungry
animal's choice, and `behaveHunt`'s fallback when nothing legal is in sight — replacing fixed diet
thresholds, and it scales the plant energy the animal absorbs, so the concession has a cost and the
diet gene still decides how much of it any lineage gets. An animal outside the band, and any adult,
meets exactly the committed engine. Measured A/B on identical seeds (`tests/scratch-juvenile-plant-allowance.ts`),
the candidate switched off at runtime for the baseline arm.

- **The baseline arm was checked before anything was compared.** Switched off, the probe reproduces
  the recorded baseline census: band 0 / 0 / 11 at 3000, populations 3198 / 3196 / 3198, predation
  338 / 161 / 6837. The two arms differ by the rule alone.
- **What it changes.** On `evolab-3` the band is alive at every census from tick 250 to 3000, peaks at
  88 members (50 of them adult) at tick 2750, and ends the run with 20 members, 11 of them adult. The
  world it lives in is not the ceiling-pinned one of every earlier candidate: the population oscillates
  between 281 and 3063 instead of sitting at 3196–3201, and predation becomes a real term — 16,782
  global deaths against the baseline's 6837. The decisive contrast is **who is in the band at the end**:
  the candidate's 20 members have inherited diets averaging 0.965, every one at 0.90+ — strict
  carnivores that stayed in the band because their juvenile stage could close the gap. The baseline's 11
  survivors average 0.676, every one inside 0.66–0.70 — animals that only held the band by sitting on
  the engine's existing sub-0.7 grazing fallback (424.2 E of plants as juveniles, 812.1 E as adults).
  The candidate band runs both channels: 419.9 E plants and 17,615.4 E meat through its juveniles.
- **What it does not change.** On `evolab` and `evolab-2` the band is zero at every census in both arms;
  neither run ever records an adult recruit in the band. The allowance never gets a subject there: the
  founding cohort dies in the first windows, before it produces anything the rule could act on. And the
  band it did produce is leaky — its attributed deaths are 202 adult and 240 recruit starvation deaths,
  the same founding-overharvest signature §6B describes, now inside a band that survives.

**Partial success, kept.** The plant half of §6B gate 1 is closed: a strict-carnivore band can raise
offspring that survive the gap and stay strict, and when such a band exists it turns the world's
census churn into oscillation under the ceiling rather than a ceiling sit-in. It is not accepted — the
bar asks two seeds, and on two of the three seeds nothing ever reaches the stage where the rule would
matter. The remaining failure is upstream of every juvenile rule: the founding cohort itself.

**(n) tested the other half of that gate — the founders' own age — and the answer is the opposite of the
guess.** `spawnFounder` stamps every founder at its maturity age, which is what makes an animal a breeder
the moment it appears; (n) removed that stamp (`c.age = 0`) so the same six animals, the same genomes and
the same lifespans, would live their first 140–190 ticks inside the sub-adult window candidate (m)
protects. Measured A/B on identical seeds (`tests/scratch-subadult-founders.ts`), the baseline arm
reproducing the committed engine exactly on all three seeds before any comparison.

- **The head-start is what the recruitment rests on.** With the stamp the founders produce 516 strict
  offspring on `evolab-3` (first at tick 31) and 1 and 6 on the other two seeds. Without it the same
  founders produce **no strict offspring at all on `evolab` and `evolab-2`**, and 182 on `evolab-3` — the
  first strict birth arriving at **tick 222 instead of 31**, a quarter of the baseline's output.
- **The sub-adult window is real, and it is not enough.** The age-0 cohort does build a band on
  `evolab-3` — 5 members at tick 250, 51 members (40 adults) at its peak — and it ends the run with
  **6 adults** where the engine's cohort ends with 20 (11 of them adults), carrying inherited diets
  averaging 0.869 against 0.965. Those animals are protected as juveniles and then enter the same adult
  world their predecessors had already emptied: their attributed deaths are 70 adult and 65 juvenile
  starvations, against the engine's 70 and 11.
- **What the two measurements say together.** (m) showed the plant channel keeps a band's *offspring*
  alive and strict; (n) shows there is no offspring without the founders' *adult* kills. §6B gate 1 is
  one gate with two halves — adult hunting and the juvenile bridge — and the engine currently has the
  second half without a candidate that has passed the first.

**The acceptance bar, restated.** §8 step 4 used to ask for "the founder band still alive at tick 3000".
Read literally that is impossible by the engine's own founder design: founders are seeded as adults with
`maturityAge` 140 and `maxAge` 1100 (`traits.ts`), so no founder individual can be alive at tick 3000, and
carnivore offspring never close the gap (candidate g/gate B-1). The bar is therefore measured as it was
written in §6D and restated after the 12-seed scan (r): **a strictly inherited carnivore band — every
member at inherited diet > 0.70 — alive at the 3000-tick census on at least 2 of 12 seeds**. The 0.66
threshold stays where it is in the engine: it is where candidate (m)'s allowance band begins, not where
persistence begins. Standing with candidate (m)'s allowance in
the engine, measured over all 12 seeds: a strict-inheritance band alive at 3000 on 1 of 12 seeds — on
`evolab-3` it is alive at every census from tick 250 and ends at 20 members, 11 adults, at inherited diets
averaging 0.965 — while 11 of the 12 seeds stand at 0 band members at the final census. With candidate
(m) patched off, the two surviving bands are `evolab-3` at 11 members averaging 0.676 and `evolab-10` at
2 averaging 0.691 — both inside the 0.66–0.70 boundary band, neither above the 0.70 the strict-carnivore
bar asks for. Not met. The plant half of §6B gate 1 is closed — band offspring now survive the gap and
stay in the band — and what remains is what the scan measures: on every seed but one a band that reaches
adults is starved out within a few hundred ticks, and every seed's founding cohort reaches zero between
ticks 198 and 1,044.

**The test world needs its own ratio.** The 48×48 fixture in `tests/helpers.ts` is 6.5% of the default
world's area with a 500-creature cap, and candidate (g) made its 15/4/3 founder loading collapse: on seeds
`probe-a` and `probe-b` the population reaches 0 within 1500 ticks (predation 44–509 per run), which broke
two milestone-5 tests. `tests/scratch-testconfig-ratio.ts` measures seven loadings on four seeds; 15/4/1 is
the smallest one alive on all four (populations reach the 500 cap, predation 4–27). The fixture now seeds
20 animals, and `FOUNDER_COUNT` in `tests/helpers.ts` is derived from the fixture config rather than
hard-coded, so the founder-id assertions in `tests/lineage.test.ts` and `tests/population.test.ts` cannot
drift from it again.

**Seed sensitivity (measured, and it matters for the test suite).** Whole-world collapse is
seed-dependent, in both the default world and the test configuration:

- Default world, 3000 ticks: `evolab-2` ends with **population 0** (6 old-age, 56 starvation, 77
  predation, 5 thermal deaths) in both the baseline and the metabolic variant, while `evolab` and
  `evolab-3` end pinned at the 3200 ceiling. Under candidate (h)'s 120/18/6 loading that collapse is gone
  on all three seeds (`evolab-2` recovers to 3100–3196), which is how the collapse was identified as
  overharvest rather than an unusable seed.
- 48×48 test configuration on seed `evolab` (`tests/scratch-testconfig-collapse.ts`): alive 11 at
  tick 250 → 4 → 3 → 1 → **0 by tick 1250**. The unit tests were unaffected only because they run on
  `probe-*` seeds; after candidate (g) the same collapse reached `probe-a` and `probe-b` and broke two
  milestone-5 tests. It is fixed by the fixture's own founder ratio (above), not by loosening a test.

Any candidate must therefore be measured on at least three seeds, and "population 0 at tick 1250"
counts as a collapse, not a stable community.

**E. Why they starve — an integration of the energy-budget measurements.** This subsection says in one place what
the records of candidates (d), (g), (i), (o), (p), (q) and (r), and the §6B answer, have already measured. Nothing
here is new measurement and no engine change is implied; every figure quoted exists in the records cited.

The engine's arithmetic makes a strict carnivore the most expensive animal in the world and then gives it one
revenue stream. Founders are seeded with the highest metabolic load in the population (metabolic rate 1.15 against a
herbivore's 0.9), the highest movement speed (sprint 1.8 — and the move cost is set by distance and speed), and the
same thermo cost every other animal pays. The only energy that enters them is the **kill**: each kill delivers at most
`prey.energy × (0.45 + 0.45 × digest)`, the remainder sinks to litter; an animal at `energy ≤ 0.2` is not prey at
all; and an adult at diet ≥ 0.7 has no plant channel at all. Starvation is what that arithmetic prints whenever
realised kill throughput falls below the bill — and every probe that has priced a carnivore's day has measured
exactly that:

- Intake against bill: 0.229–0.251 E of meat per animal-tick against 0.352–0.371 burnt, reserves 11.1 → 0.0 (the
  meat-supply probe, candidate d); kills firing from the first tick still only gross 0.347 E of prey body against a
  0.352–0.371 bill (candidate g); under the (h) founder ratio, 0.103 kills per animal-tick and 0.350 E of meat
  against 0.458 burnt — net **−0.111 E per animal-tick** (§5 item 1); kill cycles stay 40–50 ticks even where the
  chase succeeds (§6B, the quarry-commitment measurements).
- Every supplementary channel prices at a fraction of the bill: walking to the richest litter in sight draws
  0.035–0.08 E per animal-tick (the scavenge branch — implemented, measured, reverted); a carrion pool peaking at
  846 E inside the band's own senses moves the band's intake by a few E across a 3000-tick run (candidate p);
  pricing every carrion walk finds it pays for only a quarter to a third of the walks offered, and founds nothing
  (candidate q); raising `digest` is recorded as not the lever (§6B); lowering the founder metabolic load 1.15 → 0.8
  worsens whole-world deaths and leaves the band at 0 at every census (§6D table).
- None of the failure modes excluded along the way is the cause: contact with prey (fixed by clustered spawning, the
  band still 0 at the first census); the size window (no engine predator has ever declined a prey for size); thermal
  stress (0 thermal deaths in founder bands across the candidate records — the 12-seed scan does record thermal
  deaths among some founders, but starvation is the dominant founder cause on every seed); refusing chases (candidate
  o: removing the refusals made the cohort shorter-lived and no better fed); the walkability of meat (candidate q:
  the meat is reachable, affordable and does nothing).
- The starvation of *established* bands — the deaths that dominate the (m) arm of the scan — is the same arithmetic
  at equilibrium: the band over-harvests the prey within its own senses; `preyIsLegal`'s `energy > 0.2` gate then
  excludes the thinned survivors (the introduction probe shows adults at equilibrium too thin to be legal prey), and
  the plant channel that could cover the bill is closed to adults. The healthiest band this project has measured —
  20 members, 11 adults, inherited diets averaging 0.965, predation doing real work at 16,782 deaths — still starves
  202 adults and 240 recruits. A band is not failing to hunt; its realised throughput still sits under its bill.

So the honest answer to "why do they starve" is: a strict carnivore's realised energy intake in this world sits
consistently below its metabolic bill — not because meat is unavailable (supply, price, walkability and size have all
been measured, and none is the binding constraint) but because kill throughput, the engine's only carnivore revenue,
cannot be sustained at bill-rate, and the one channel that could make up the difference — plants — is closed to
adults by design. The only intervention that has moved the outcome is reopening that channel for the young
(candidate m) — itself evidence for where the binding constraint sits.

What remains genuinely open is *why* kill throughput cannot exceed the bill at equilibrium. The intake-vs-bill
figures above are measured; the dynamics behind them — how thin a prey population's bodies sit against the
`energy > 0.2` gate, and how fast thinned prey rebuild body energy inside a band's hunting range — have never been
priced. A candidate aimed at §6B gate 1 should measure that before adding a mechanism. (§8 candidate list, step 4.)

That measurement has a handle now: §3's "Quarry-energy floor" is this same gate made configurable
(`config.predation.minPreyEnergy`, read by `preyIsLegal` at engine.ts:830 on every tick). It is recorded here as a
way of measuring the question, not as an answer to it: raising the floor does not give any animal more energy, it
only removes thinned ones from what a band may chase, and no run at a raised floor has been run yet. With the floor
as a parameter the scan is ordinary: hold everything else fixed, raise the floor in steps from 0.2, and read what
happens to kill throughput and to the band's bill. If throughput is flat across floors, this paragraph's framing is
wrong and the constraint sits elsewhere; if it moves, the distribution of quarry body energy against the floor is
the number §6B gate 1 has been missing.

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

**Current state: it runs.** The cohort bookkeeping above is implemented and the probe prints its
window tables; its readings are what §6A is built from. It remains a print-only diagnostic — the
assertions belong to step 5 below.

**The candidate probes added in this loop** (all plain node scripts, run with `npx tsx`, none of them
part of the vitest suite):

| Probe | What it measures |
|---|---|
| `tests/scratch-founder-metabolism.ts` | founder carnivore count and the whole carnivore band every 250 ticks, 3000 ticks, seeds `evolab`, `evolab-2`, `evolab-3`, with per-run death tallies (the candidate table in 6) |
| `tests/scratch-founder-prey-visibility.ts` | legal prey (engine gates) visible to each founder carnivore at t=0, and the distance to the nearest legal quarry |
| `tests/scratch-testconfig-collapse.ts` | whether the 48x48 test configuration collapses on the `evolab` seed |
| `tests/scratch-meat-supply.ts` | the cohort's own meat economy in the window in which it dies: its own sensory radius, what it is allowed to eat and how far away it is, what its own chase rule would commit to, and its energy intake against its bill. Also reports what its strikes and kills cost |
| `tests/scratch-carrion.ts` | the litter/detritus pool: how much of it a carnivore stands on, how much its hunting asks for, and how much it actually draws with and without a scavenging behaviour in the engine. Runs both the default world and the 48x48 configuration |
| `tests/scratch-founder-thermal.ts` | the temperature the founder band is actually exposed to: spawn deviation against its own optimum and tolerance, and every death in each founder window by cause |
| `tests/scratch-founder-ratio.ts` | founder loading on the default world: five `herbivore/omnivore/carnivore` variants × 3 seeds, with the band's size at every 250-tick census to 3000 ticks and the whole-world death tallies |
| `tests/scratch-testconfig-ratio.ts` | the same question on the 48×48 test fixture (4 seeds × 1500 ticks): which loadings collapse and which hold |
| `tests/scratch-late-introduction.ts` | carnivores injected at tick 1500 into a world that has already reached its producer equilibrium: band size and death causes every 250 ticks |
| `tests/scratch-carnivore-band.ts` | where the carnivore band goes under the committed default: the strict band (inherited diet > 0.66) separated from the whole carnivore band, census counts per window, and every animal's exit attributed to the cause the engine itself recorded — dying and diet drift out of the band are kept apart |
| `tests/scratch-carnivore-collapse.ts` | individual-by-individual accounting of the recruited cohort behind the band's 1-of-3-seed survival at tick 3000: every animal's exit attributed from its last observed state |
| `tests/scratch-carnivore-quota.ts` | the candidate (j) A/B measurement: every seed run twice, once with the recruitment-quota exception live in `preyIsLegal` and once switched off at runtime, same config, same world |
| `tests/scratch-productivity-ladder.ts` | the candidate (k) measurement: `environment.sunlight` rungs 1.00 → 0.85 → 0.70 → 0.55 plus a famine preset (0.42 sunlight / 0.62 rainfall) with `maxCreatures` held at 3200, asked as the acceptance test itself on three seeds × 3000 ticks |
| `tests/scratch-pack-hunt.ts` | the candidate (l) A/B measurement: the pack mass-window rule switched on and off on identical seeds, the candidate patched onto the committed engine at runtime; counts the strongest window factor the rule computed, the quarry picks and kills it made possible above the solo window, and band size at every census |
| `tests/scratch-juvenile-plant-allowance.ts` | the candidate (m) A/B measurement: the juvenile plant allowance switched on and off on identical seeds, the switched-off arm verified against the recorded baseline before any comparison; separates founding cohort from recruited band, and reports the band's plant and meat intake, its inherited-diet census, and every attributed death |
| `tests/scratch-subadult-founders.ts` | the candidate (n) A/B measurement: the strict carnivore preset run twice per seed, once as committed and once with the founded animals seeded as full-grown adults, the only change applied to the committed engine at runtime; follows every seeded animal from birth to death, splits the strict band into founders and recruited animals, and reports each seed's first strict birth, strict death, and extinction time in both arms |
| `tests/scratch-pursuit-flight-gate.ts` | the candidate (o) A/B measurement: the chase gate swapped on the instance — the committed gate reinstated for the baseline arm, the engine's flight-priced gate for the candidate arm — and every `pursuitIsWorthwhile` call about animals the strict cohort may eat priced against the walk to a quarry standing still, alongside band censuses, the founders' hunt chain and energy ledger, attributed band deaths, and inherited-diet buckets at the final census |
| `tests/scratch-carrion-scavenge.ts` | the candidate (p) measurement: the committed engine, the same engine with carrion fed only by kill leftovers, and the same engine with carrion fed by every natural-cause corpse — carrion energy standing on the map at each census, the peak pool and the energy it takes in, what the band eats and how many carrion meals it takes, attributed band deaths, and the baseline arm verified against the recorded baseline on all three seeds |
| `tests/scratch-carrion-walk.ts` | the candidate (q) measurement: the same carrion pool made *reachable* — the committed engine, candidate (p)'s standing-carrion rule, and the rule that prices a visible carcass with the animal's own energy bill and walks to it; how many times the walk rule is asked, how many walks it takes, how many it refuses and for what reason, carrion eaten with and without the walk, strict-band censuses and pool size at every 250-tick census, attributed band deaths, and the baseline arm verified against the recorded baseline on all three seeds |
| `tests/scratch-recruitment-scan.ts` | the candidate (r) measurement: 12 seeds `evolab`, `evolab-2` … `evolab-12` × 3000 ticks run twice — the committed engine, and the same engine with `juvenilePlantAllowance` patched to return zero at runtime — each arm checked against its recorded baseline before any comparison. Per seed it reports the tick the founding strict cohort reaches zero and of what cause, every strict birth and whether its parents were strict or born strict, whether any recruit lived past its own `maturityAge`, the strict band at every 250-tick census, peak band adults, the band at the 3000-tick census, the population peak and how many censuses sat at the 3200 ceiling, predation, and the inherited-diet buckets at the final census |

Each probe prints a table and nothing else; a candidate's numbers are copied from that output into
§6D. They are kept in the tree so every recorded result can be re-run.

---

## 8. Order of work

1. ✅ Probe rebuilt and run (§7).
2. ✅ Causes identified and written into §6 (A: founder cohort never reaches legal prey; B:
   carnivory cannot recolonise; C: the ceiling, not ecology, sets current numbers).
3. Candidates measured one at a time; every result is in §6D. Nothing so far has produced cohort
   persistence. What has changed is the diagnosis: contact, price, distance and temperature are all
   excluded, and overharvest at founding is what remains:
   a. quarry commitment, founder speed 1.8, flight-initiation distance (earlier pass) — no effect;
   b. ✅ **Clustered founder spawning** (`findSpawnNear` rings, herbivores 10 / omnivores 8 /
      carnivores 15 around a fertile core) — kept: it fixed the contact failure it was written for
      (§6A), the band still dies;
   c. ❌ **lower founder metabolic load 1.15 → 0.8** — rejected, measured null (§6D).
   d. ❌ **the meat a strict carnivore can reach** (`tests/scratch-meat-supply.ts`, no engine change):
      0.00 legal animals inside the cohort's own senses (radius 7.6–8.5 tiles) at every scan, both
      seeds; nearest animal it is allowed to eat 6.6–8.7 tiles away; whole meat economy 0.23–0.25 E
      per animal-tick against a 0.35–0.37 bill. The diagnosis moved from price to distance (§6D).
   e. ❌ **opening the world's litter pool to it** (`World.takeDetritus` given to `behaveHunt`): it
      drew 0.04–0.08 E per carnivore-tick, and every census came out the same with the pool open or
      closed. Rejected, and the change was reverted; the engine has no carrion consumer.
   f. ❌ **founder adaptation to the local climate** (`tests/scratch-founder-thermal.ts`): ruled out
      before it was implemented — spawn deviation 3.5–5.1 °C inside a 10–12 °C tolerance band, and 0
      thermal deaths in any founder window. Thermal stress does regulate the whole population (100–310
      deaths per 250-tick window), it is just not what this cohort dies of.
   g. ✅ **herd-anchored founder spawning** — carnivores seeded 1–2 tiles from a producer founder
      instead of on a ring at 15. Kills land from tick 1: 0.060–0.064 per animal-tick, 0.347 E of prey
      body in against a 0.352–0.371 E bill. Kept: it removed the distance the meat-supply probe named
      and exposed overharvest as the binding constraint.
   h. ✅ **founder loading ratio** (`tests/scratch-founder-ratio.ts`, five loadings × three seeds):
      120/18/6 is the default now. No seed collapses, a carnivore band is alive at the 3000-tick census
      on `evolab-3`, and on that seed the population stays below the 3200 ceiling (2814–2939) for the
      last 1250 ticks, under 6837 predation deaths. The 48x48 test fixture needed its own ratio: 15/4/1
      (`tests/scratch-testconfig-ratio.ts`), because 15/4/3 collapses on two of the test seeds.
   i. ❌ **a strict meat-eater allowed to take young prey while its prey population is growing** — the
      recruitment quota (`quarryQuota` in `preyIsLegal`, the allowance recomputed at every census from the
      growth that census recorded, capped at one kill per animal the species already has), implemented and
      measured A/B on identical seeds with `tests/scratch-carnivore-quota.ts`, and **reverted**. It engages:
      49 / 10 / 747 juvenile kills against 0, adult kills down 338 → 168, 161 → 157, 6837 → 3793, and the
      largest mid-run band measured in this project (26–28 on `evolab-3`, ticks 750–1250) — which then
      collapses to 0 from tick 2000 and ends the run at 0 / 0 / 0 where the standing rule leaves 11. The
      plant-channel half of the same question (a plant fallback for diet ≥ 0.7) was measured in an earlier
      pass and rejected the same way. (§6D candidate j.)
   j. **Lower primary productivity so the population lives under the cap** — implemented and measured,
      **rejected**. Implemented as a rung ladder in `config.ts`'s `environment` rungs lowering sunlight
      1.00 → 0.85 → 0.70 → 0.55 plus a famine preset at 0.42 sunlight / 0.62 rainfall, with
      `maxCreatures` pinned at 3200; the measurement asks the acceptance test itself on three seeds
      (`tests/scratch-productivity-ladder.ts`, 3000 ticks, no engine change). Every lowered rung either
      keeps the population pinned at 3200 through tick 3000 or collapses the founding community to 0; no
      lowered rung produced a population living under the cap or kept a strict cohort past tick 3000
      anywhere, and the only settings that never pinned at 3200 were ones that could not found a
      community at all. The full record is in §6D candidate (k) and §6E. **This item closes the ordered
      candidate ladder: a–i closed the behavioural-gates question one by one, and this item closes the
      crowding explanation §6C named. What remains is not another knob to measure but a design change**
      — the concrete next candidate is the prey-size asymmetry of §6B, a refuge predation cannot open,
      which is a new class of mechanism, not another rung on the same ladder.
   k. ❌ **pack hunting — a pack widens its own prey-mass window** — the new mechanism class named
      above, implemented in `engine.ts` (a `packHuntBonus` scaling the `preyIsLegal` mass window by
      `+ 0.35 × sociality` per mature same-species bandmate, max 3, tied to the existing heritable
      sociality trait) and measured A/B on identical seeds with `tests/scratch-pack-hunt.ts`.
      **Rejected; the change was reverted.** It fires on every seed (max factor 1.52 / 1.69 / 1.66)
      and opens nothing: 1 quarry pick and 0 kills on prey above the solo window across three seeds,
      band 0 / 0 / 7 against 0 / 0 / 11 with the rule off. §6B's size gate does not bite in these
      worlds — no animal is ever declined for size, because none is ever outside its hunter's own
      window — so a mechanism whose only effect is to widen the legal-prey window cannot move the
      band. What the acceptance test still needs must act on the constraint that does bind: the
      founder cohort's energy flow and the recruitment gap (§6B gate 1). (§6D candidate l, §6E.)
   m. 🟡 **juvenile plant allowance for strict carnivores** — a `juvenilePlantAllowance(c)` in
       `engine.ts`: a band animal below its `maturityAge` is given a plant channel scaled as
       `max(0.2, 1 − (diet − 0.66) / 0.34)`, consulted wherever the engine already decides an animal
       eats plants, and the plant energy it absorbs is scaled by the same factor; adults and animals
       outside the band are untouched. Implemented in `engine.ts`, measured A/B on identical seeds with
       `tests/scratch-juvenile-plant-allowance.ts`. **Kept; partial success.** The baseline arm
       reproduces the recorded baseline before any comparison; then, on `evolab-3`: a band alive at
       every census from tick 250, peaking at 88 (50 adults) and ending at 20 with 11 adults and
       inherited diets averaging 0.965 — strict lineages surviving the gap, where every earlier
       candidate's survivors were boundary drifters at 0.676 — with the world oscillating 281–3063
       instead of sitting pinned at the ceiling, and predation reaching 16,782. On `evolab` and
       `evolab-2` nothing changes: 0 at every census on both arms, because the founding cohort dies
       before the rule has anything to act on. The plant half of §6B gate 1 is closed; what remains is
       upstream of every juvenile rule — the founding cohort itself, which on two of three seeds dies
       before producing a juvenile the rule could reach. (§6D candidate m.)
   n. ❌ **sub-adult founders — the same strict founders seeded at age 0** — `spawnFounder`'s
      `c.age = phenotype.maturityAge` replaced by `c.age = 0`, so the cohort spends its first
      140–190 ticks inside the window candidate (m) protects instead of arriving past it. Measured A/B
      on identical seeds with `tests/scratch-subadult-founders.ts`, the age stamp restored at runtime
      for the baseline arm, which reproduces the committed engine on all three seeds before anything is
      compared. **Rejected, no engine change.** The head-start the design gives founders is what its
      recruitment rests on: 516 strict births become 182, the first strict offspring arrives at tick
      222 instead of 31, and `evolab` and `evolab-2` produce **no strict offspring at all**. The
      window does work for the animals it covers — a band forms on `evolab-3` at the first census —
      but it ends at 6 members at inherited diets averaging 0.869 against the engine's 20 at 0.965,
      because a cohort that never killed as adults has nothing to wean its young onto. The remaining
      constraint is not the founders' age: it is that the only meat in these worlds is what adult
      founders make, and on two seeds the founding cohort spends that window dying.
      (§6D candidate n.)
   o. ❌ **price the chase gate with the engine's own prey-flight behaviour** —
       `pursuitIsWorthwhile` modelled quarry flight as "fleeing at full speed if healthy and above
       45% of reserve"; this candidate replaced that model with the flight behaviour the engine
       itself runs in `updateCreature`: quarry is threatened only above the threat-mass ratio,
       flees only within the lesser of its own sense radius and the engine's fleet limit, only
       while its reserve stands above 0.45, and a quarry below 0.25 stands its ground instead of
       being assumed to flee. Implemented in `engine.ts`, measured A/B on identical seeds with
       `tests/scratch-pursuit-flight-gate.ts`, the committed gate reinstated on the instance for
       the baseline arm, which reproduces the recorded baseline exactly on all three seeds.
       **Rejected; the engine change was reverted.** The probe first priced the committed gate's
       refusals: 444 / 460 / 41,438 refusals, **72–90% of them priced away by the flight model
       alone** (the bite would have covered the walk cost on its own against a quarry standing its
       ground), while quarry at or above the hunter's own speed accounted for 0 / 0 / 182 — the
       flight model was almost never the reason a hunt was refused. Replacing it opens exactly
       those refusals, and the founding cohort is worse for it: cohort animal-ticks 977 → 809,
       958 → 665, 2,442 → 624; the `evolab-3` band peaks at 19 against 88 and ends at 15 against
       20, at inherited diets averaging 0.686 against 0.965. Bands at the 3000-tick census:
       **0 / 0 / 15** — 1 of 3 seeds. The refusals the candidate removed were load-bearing: they
       kept founders out of chases the whole hunt cannot pay for. The chase gate is not the
       binding constraint; §6B gate 1 — the founding cohort's energy flow and the recruitment gap
       — is. (§6D candidate o.)
   p. ❌ **carrion as a meat source: kill leftovers held in a carrion pool** — a per-tile carrion
        pool (`CARRION_MAX = 30` E, sinking into litter at `CARRION_SINK_RATE = 0.03` per tick) fed
        by the body a kill does not eat, plus a `behaveHunt` branch in which a band animal whose
        `pickQuarry` returns nothing consumes carrion standing on **its own tile** at
        `0.45 + 0.45 · gutFill`. Implemented in `engine.ts` / `world.ts`, measured with
        `tests/scratch-carrion-scavenge.ts` on the three seeds — the committed engine reproduced
        exactly on all three before any comparison — with a third arm in which natural-cause corpses
        feed the same pool. The band ate **2.6 / 1.6 / 2.5 E in 6 / 4 / 5 meals** off the kill-fed
        pool (peak standing carrion 4.5 / 1.1 / 6.6 E); opening that pool to every natural-cause
        corpse put **846 / 622 / 871 E** at its peak, tens of thousands of E cycling through it with
        nearly all of it sinking unused into litter, and moved the band's intake only to
        **2.6 / 3.3 / 4.6 E**. Bands at the 3000-tick census: **0 / 0 / 0** on both carrion arms,
        against **0 / 0 / 20** with carrion off; predation fell 601 → 141, 151 → 149, 16,782 → 232,
        and the `evolab-3` population that had been swinging 281–3063 came back onto the cap.
        Rejected, nothing left in the engine. The candidate's own numbers say why it failed: supply
        was never the binding variable, because carrion reached only animals already standing on it.
        What that leaves untested is the other half — **detecting a carcass within one's own senses
        and paying for the walk to it**, the arithmetic `pursuitIsWorthwhile` already performs for a
        live chase. (§6D candidate p.)
    q. ❌ **carrion a carnivore has to walk to — the carrion made reachable.** A `behaveHunt` branch
       that, when it has no quarry to commit to, scans the carrion standing inside the animal's own
       perception and prices each candidate exactly as `pursuitIsWorthwhile` prices a live chase — the
       bite that animal can actually take, against the cost of the ticks its own speed needs to cross
       the gap — and walks to the best carcass that pays for its own walk. Measured with
       `tests/scratch-carrion-walk.ts` on all three seeds alongside the standing-carrion rule (the
       candidate (p) rule) and the committed engine, the baseline arm reproduced exactly on all three
       seeds first. It does change what a band animal eats: across the three seeds, carrion eaten rises
       from **26 meals** on the standing-carrion arm to **636 meals** on the walk arm (111 / 109 / 416
       meals) — but the walk is worth taking only 22% / 13% / 35% of the time it is asked: the
       rule was asked 504 / 822 / 1,170 times and walked to a carcass 111 / 106 / 413 of them, and
       every refusal was priced — 393 / 716 / 757 refusals of walks that do not pay for themselves,
       0 refusals for having no reserve. What carrion actually reaches the band rises from 2.6 /
       3.3 / 4.6 E to **82.0 / 73.8 / 316.2 E** (111 / 100 / 406 of the meals at walked-to
       carcasses) and predation falls to 153 / 126 / 301 against 601 / 151 / 16,782 with carrion
       off. And the band is still **0 at the 3000-tick census on all three seeds** — it appeared
       mid-run on 2 of 3 seeds, peaking at 1 / 0 / 2 members, and died — with no seed collapsed
       (populations 3194 / 3193 / 3196). Rejected, nothing kept in the engine. Pricing every
       walkable resource, as §6A requires, removes the last excuse not to walk, and walking still
       does not close the gap: the carrion pools peak at 810.8 / 496.1 / 889.6 E with 31,419.2 /
       18,294.7 / 37,721.3 E sinking unused. Detection and reach were the last untested half of
       the carrion question; closing it leaves the binding constraint where candidate (o) left it
       — the founding cohort’s energy flow and recruitment (§6B gate 1), not where the meat is.
       (§6D candidate q.)
   r. ✅ **The 12-seed recruitment scan — a measurement, not a candidate.** `tests/scratch-recruitment-scan.ts`,
      both arms (§6D candidate r), 12 seeds × 3000 ticks on the committed engine and with (m) patched
      off. Every link of the recruitment question tallied per seed: a strict animal is born on
      **12/12** seeds, every time from strict parents, always after the seed cohort has died; a strict
      recruit lives past its own `maturityAge` on 10/12; a band of adults forms on 8/12; and a band is
      alive at the 3000-tick census on **1/12** — `evolab-3`, 20 members, 11 adults, mean inherited
      diet 0.965, lineage 15 generations deep with no seeded animal in it. With (m) patched off, the
      two survivors are boundary cases: 11 members averaging 0.676 and 2 at 0.691 — inside the
      engine's 0.66 candidate gate, not above the strict 0.70 line the bar asks for. On both arms,
      every band that reached adulthood lost it to starvation within a few hundred ticks, and every
      seed's founder cohort reached zero between ticks 198 and 1,044. **Verdict: not the acceptance
      bar — 1 seed of the 12 required 2.** The scan's value is that it measures each link without
      adding any rule: it shows the remaining barrier is exactly §6B gate 1 — the founding cohort's
      own energy flow and recruitment — with everything downstream of it now instrumented. Full per-seed
      record in §6D row r. (Report: `.dev/recruitment-scan.txt`, regenerated by re-running the probe.)
   s. ❌ **cooperative predation — a pack acting on the hunt. Withdrawn before building: it is
      candidate (k) under a different name.** The 12-seed scan shows where band animals die — starved
      as adults, at band density, after heavy predation — and that reads like an untried failure of
      group hunting. It is not one. A pack taking prey no single member could take is exactly what
      candidate (k) was: a `packHuntBonus` widening the prey-mass window per mature bandmate, which
      engaged on every seed and produced 1 prey interaction above the solo window and 0 kills of it
      (§6D entry k). It engaged everywhere and improved nothing because the size gate does not bite in
      this world — no animal is ever outside its own solo window, so a mechanism acting on the
      take-down limit has nothing to act on. The recruitment scan closes the same door from the other
      side: bands are not lost to failed captures but to starvation with their prey base already
      heavily depleted by the band's own adults. The binding barrier stays §6B gate 1 — the founding
      cohort's energy flow and recruitment — upstream of any mechanism aimed at adults. A group-hunting
      candidate would have to act on some dimension other than the take-down window to be new at all,
      and the take-down dimension is measured closed. Nothing was built, so nothing needs reverting;
      the entry stands as the record of why this mechanism class is closed. (§6D candidate k.)
4. Acceptance test, restated as §6D and the 12-seed scan record it: **a strictly inherited carnivore band
   — every member at phenotype diet > 0.70 — alive at the 3000-tick census on at least 2 of 12 seeds**, no
   seed collapsing to population 0, and the 48x48 fixture no longer collapsing. The wording used here
   until now — "the founder band is still alive at tick 3000" — cannot be met by design: founders are
   seeded as adults with `maturityAge` 140 and `maxAge` 1100 (`traits.ts`), so no founder individual can
   still be alive at tick 3000. Standing for the 120/18/6 default, with candidate (m)'s allowance in the
   engine: per the 12-seed scan (r), a band alive at 3000 on **1 of 12** seeds — `evolab-3`, alive
   at every census from tick 250, ending at 20 members with 11 adults at inherited diets averaging
   0.965, on a world whose population never reaches the ceiling; and 0 at the final census on the
   other 11 seeds. With candidate (m) patched off the survivors are 2/12, both inside the candidate
   gate: `evolab-3` at 11 members averaging 0.676 and `evolab-10` at 2 at mean 0.691, neither above
   the 0.70 the bar asks for, and no seed collapsed. **Not met yet.** A candidate that
   only works while the population is pinned at the 3200 ceiling does not count.
5. ✅ Done (milestone 5). The diagnosis became assertion tests: `tests/conservation.test.ts`
   (1000-tick energy audit), `tests/determinism.test.ts`, `tests/lineage.test.ts` (inheritance /
   mutation / engine genealogy), `tests/population.test.ts` (census bookkeeping). The probes remain
   as diagnostic documentation. A test for a *persisting* multi-band food web is still impossible —
   that outcome does not exist yet (step 3 above).
6. ✅ The interface in §3 is written and verified live: a canvas world plus live panels, so the
   diagnosis is visible rather than only printed. Visual polish deferred.
7. Performance work only after there is a real render path to measure.

---

## 9. Commands

```
npm run dev                              # dev server — the live interface (http://localhost:5173)
npm run test                           # vitest — 10 files / 54 tests pass
npm run build                          # vue-tsc + vite build — clean
npm run typecheck                    # vue-tsc — clean (it type-checks tests/**/*.ts)
npx vitest run tests/scratch.test.ts   # the food-web probe on its own
npx vite-node tests/scratch-pursuit.ts # per-chase-episode diagnostic (prints)
npx vite-node tests/scratch-population.ts [ceiling]
                                       # population trajectory vs the ceiling; optional
                                       # ceiling override raises maxCreatures for the run
npx vite-node tests/scratch-cap-probe.ts
                                       # the ceiling lowered, then raised, on a live world (§3)
npx vite-node tests/scratch-jpa-probe.ts
                                       # the default-world band censuses behind the juvenile-plant-
                                       # allowance test, both arms (§3)
npm run test:perf                  # perf benchmarks — 3 pass; measured baselines in §10
npm run test:e2e                   # Playwright E2E — 4 pass (chromium against the dev server)
npm run test:all                   # unit + perf + e2e in sequence — all green
```

Note: `npx vitest run` at the repository root matches no test files, because the package lives in the
nested `EvoLab/` folder; run the suite from `EvoLab/`.

---

## 10. Performance baselines (milestone 6)

Measured on this development machine. `npm run test:perf` prints these on every run; the assertion
limits sit ~10× below them on purpose, so a perf failure means an algorithmic regression, not noise.

| Load case | Measured | Test limit |
| --- | --- | --- |
| 48×48 test world, warm population 499 (its ceiling) | **1.4–1.8 ms/tick** | 50 ms/tick |
| default 168×112 world, world generation | **18–20 ms** | 1000 ms |
| same default world, warm population ~3200 (the cap) | **13–16 ms/tick** | 100 ms/tick |
| in-memory save/restore of a warm 48×48 world | **3.5–3.9 ms** | 1000 ms |

The 100 ms/tick figure is not invented headroom: 10 ticks/s is the top UI speed preset, and the
engine shares every animation frame with canvas rendering and panel updates. At 16 ms/tick the
engine still leaves the majority of each frame budget to rendering.

Growth cost curve (`npx vite-node tests/scratch-perf-probe.ts`, ms/tick per 200-tick batch on the
default world): **1.3 ms/tick at population 58 (tick 200) → 13–16 ms/tick at the 3200 ceiling
(tick 2400)** — cost scales roughly linearly with population; no superlinear blow-up observed at
any population size tested.

E2E run cost: `npm run test:e2e` — 4 chromium tests, ~5 s total.


