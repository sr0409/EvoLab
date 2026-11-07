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
| 4 Interface | **done, verified live** | `src/main.ts`, `src/App.vue`, `src/store.ts` (loop + UI state; the Simulation is kept out of Vue reactivity), canvas world renderer (terrain / biomass / temperature views + creature overlay), live census & energy-audit panel, time-series charts (`CHART_FIELDS`), species roster, event log. Verified against the running dev server: tick advances, canvas paints, panels populate |
| 5 Quality | **done, 25 tests pass** | engine fix: offspring now record both parents in the lineage store (`makeCreature` took no parent ids before). Assertion tests: `tests/conservation.test.ts` (ledger balances across 1000 ticks, pool accounting, brood energy handover), `tests/determinism.test.ts` (same seed → identical state; different seeds diverge), `tests/lineage.test.ts` (inherit stays inside parent bounds, mutate stays in trait ranges, engine genealogy complete/acyclic, ages match birth ticks), `tests/population.test.ts` (census on schedule, diet classes partition the population, births/deaths census records add up, species bookkeeping). Shared `tests/helpers.ts` gives a 48×48 test world. `npm run test` → 6 files / 25 tests pass; `npm run build` clean |
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
src/sim/config.ts     `defaultConfig()`, scenario presets (`SCENARIOS`)
src/sim/types.ts      shared types, behaviour constants, `DEATH_CAUSES`, `dietClassOf`
src/sim/engine.ts     the step function, `EnergyLedger`, `auditEnergy()`, event log, census history,
                      `toState()` / `fromState()` with `SIM_STATE_VERSION`, `CHART_FIELDS`

src/main.ts           mounts `src/App.vue` into `index.html`
src/env.d.ts          Vue SFC module declaration
src/store.ts          owns the `Simulation` and the requestAnimationFrame loop (capped ticks per
                      frame); reactive `ui` control state only (running / speed / map view / selected
                      species / `frame`), `getSim()`, `stepOnce`, `newWorld`, scenario + speed presets
src/App.vue           app shell; starts the loop on mount, stops it on unmount
src/ui/ControlBar.vue run/pause/step, speed select, seed + new world, scenario presets, map-view
                      buttons, live tick/season/creature readout
src/render/WorldCanvas.vue  one-pixel-per-tile ImageData (terrain / biomass / temperature views)
                      upscaled to the display canvas, then creature dots; reads only, never writes
src/ui/StatsPanel.vue live census, diet-composition bars, trait averages, deaths by cause, the
                      energy audit with a drift indicator
src/ui/ChartsPanel.vue canvas line charts from `sim.seriesSamples` over `CHART_FIELDS`
src/ui/SpeciesTable.vue species roster (lineage, abundance, peak, status); rows select a species for
                      the map highlight
src/ui/EventLog.vue   newest-first event list

tests/helpers.ts             shared test config (`testConfig`: 48×48 world, 22 founders, cap 500) + `runSim` helper
tests/conservation.test.ts   energy-cycle assertions over 1000 ticks (see §4)
tests/determinism.test.ts    same seed → identical state; different seeds diverge
tests/lineage.test.ts        inheritance/mutation bounds + engine genealogy assertions
tests/population.test.ts     census bookkeeping: schedule, diet partitioning, birth/death accounting
tests/physiology.test.ts     founder-archetype probe; runs (vitest)
tests/scratch.test.ts        food-web cohort probe; rebuilt and runs (see §7)
tests/scratch-pursuit.ts     diagnostic: per-hunt-episode results; run with `npx vite-node`
tests/scratch-population.ts  diagnostic: population trajectory against the ceiling; run with `npx vite-node`
tests/scratch-audit.ts       diagnostic: energy ledger vs population trajectory; run with `npx vite-node`
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
2. `src/App.vue` + `ControlBar` — play/pause/step, speed, seed + new world, the `SCENARIOS` presets.
3. `src/render/WorldCanvas.vue` — a renderer that only *reads*: terrain/biomass/temperature from
   `world`'s tile arrays into an ImageData buffer upscaled to the display canvas, creature dots on
   top, species highlight on selection. It never writes simulation state.
4. `StatsPanel` / `ChartsPanel` / `SpeciesTable` / `EventLog` — fed by `sim.lastCensus`,
   `sim.seriesSamples`, `auditEnergy()`, `sim.species` and `sim.events`.

Verified against the dev server (`npm run dev`, http://localhost:5173): clicking Run advances the tick
readout (measured 3296 → 3356 over 5 s), the season and creature counts update, the world canvas
paints terrain and creatures, the census/species panels populate. `vue-tsc` is clean over the UI and
`npm run test` stays green. Visual polish (layout, palette, minimap) is deferred.

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
2. **The population ceiling, not ecology, is what regulates numbers.** Same trace: the herd fills
   `maxCreatures` (3200) by ~tick 750 and stays pinned exactly there for the remaining 5000+
   ticks while vegetation stays healthy. Raising the ceiling to 12000 does not find a stable
   carrying capacity either — it produces overgrazing boom-and-bust (§6C). A hard design limit was
   added so no run can outrun its intended size: `normalizeConfig` now clamps `maxCreatures` to
   **4000** (was 20000); the default stays 3200.
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
   and carrying energy > 0.2 (`preyIsLegal`, engine.ts 734–741). When one herbivore lineage
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
K still sits at the ceiling, lower primary productivity rather than raise the ceiling.

**D. Candidate records for this loop (measured).** Each candidate below was measured with the probes
in §7 on the default world (168×112), seeds `evolab`, `evolab-2`, `evolab-3`, 3000 ticks, census
every 250 ticks. The engine was not changed for a candidate until the candidate produced a result.

| Candidate | Measured result | Verdict |
|---|---|---|
| Clustered founder spawning (rings 10/8/15 around a fertile core, `engine.ts` ~258) | Founder bands now see legal prey at t=0 (0–53 legal prey visible per founder, nearest legal quarry 0–6 tiles, most 0–2). Carnivore band still **0 at the first census** on all three seeds | **Kept.** It fixed the contact failure it was written for; it does not by itself keep the band alive |
| Founder metabolic load 1.15 → 0.8 (`traits.ts`, `metabolism.founders.carnivore`) | Identical outcome: founder band 0 at the first census, carnivore band 0 at every census, on all three seeds. Whole-world death tallies *worsened* (seed `evolab`: starvation 2895 → 4073, thermal 1517 → 2108). Final population 3196/3190 and 3200/3196 — the ceiling, not the band, sets the number | **Rejected** (not committed) |

The two results together say the same thing: with legal prey visible a few tiles away and a smaller
energy bill, the founder carnivores still do not eat. The remaining constraint is on the **supply of
meat energy a strict carnivore can actually convert**, not on the band's own budget. That is the next
candidate (a food-web change: who is available as quarry and what a kill yields), not a founder-trait
change.

**Seed sensitivity (measured, and it matters for the test suite).** Whole-world collapse is
seed-dependent, in both the default world and the test configuration:

- Default world, 3000 ticks: `evolab-2` ends with **population 0** (6 old-age, 56 starvation, 77
  predation, 5 thermal deaths) in both the baseline and the metabolic variant, while `evolab` and
  `evolab-3` end pinned at the 3200 ceiling.
- 48×48 test configuration on seed `evolab` (`tests/scratch-testconfig-collapse.ts`): alive 11 at
  tick 250 → 4 → 3 → 1 → **0 by tick 1250**. The unit tests are unaffected only because they run on
  `probe-*` seeds and 1500 ticks.

Any candidate must therefore be measured on at least three seeds, and "population 0 at tick 1250"
counts as a collapse, not a stable community.

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

Each probe prints a table and nothing else; a candidate's numbers are copied from that output into
§6D. They are kept in the tree so every recorded result can be re-run.

---

## 8. Order of work

1. ✅ Probe rebuilt and run (§7).
2. ✅ Causes identified and written into §6 (A: founder cohort never reaches legal prey; B:
   carnivory cannot recolonise; C: the ceiling, not ecology, sets current numbers).
3. Candidates measured one at a time; every result is in §6D. Nothing so far has produced cohort
   persistence:
   a. quarry commitment, founder speed 1.8, flight-initiation distance (earlier pass) — no effect;
   b. ✅ **Clustered founder spawning** (`findSpawnNear` rings, herbivores 10 / omnivores 8 /
      carnivores 15 around a fertile core) — kept: it fixed the contact failure it was written for
      (§6A), the band still dies;
   c. ❌ **lower founder metabolic load 1.15 → 0.8** — rejected, measured null (§6D).
   Next candidate, in order:
   d. **The meat-energy supply of a strict carnivore**: the legal-prey mass/energy gates and what a
      kill yields (`preyIsLegal`, `pickQuarry`, the absorbed-energy formula). Two candidates found
      dead ends in the carnivore's own budget; this is the other side of the exchange.
   e. **Founder adaptation to local conditions** (thermal optimum matched to spawn climate):
      thermal stress is a top-three cause of death at every population scale (§6C).
   f. If a multi-band community survives, **re-measure carrying capacity**; only if it is still
      pinned at the ceiling, lower primary productivity (sunlight/rainfall) so the ecosystem
      settles below 3200 on its own instead of being clipped.
4. Acceptance test for the next candidate, measured on three seeds: the founder band is still alive
   at tick 3000 on at least two seeds (`tests/scratch-founder-metabolism.ts`), `scratch.test.ts`
   shows cohort persistence beyond ~1000 ticks, and `tests/scratch-testconfig-collapse.ts` shows the
   48×48 configuration no longer collapsing. A candidate that only works while the population is
   pinned at the 3200 ceiling does not count.
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
npm run test                           # vitest — 6 files / 25 tests pass (milestone 5)
npm run build                          # vue-tsc + vite build — clean
npm run typecheck                    # vue-tsc — clean (it type-checks tests/**/*.ts)
npx vitest run tests/scratch.test.ts   # the food-web probe on its own
npx vite-node tests/scratch-pursuit.ts # per-chase-episode diagnostic (prints)
npx vite-node tests/scratch-population.ts [ceiling]
                                       # population trajectory vs the ceiling; optional
                                       # ceiling override raises maxCreatures for the run
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
