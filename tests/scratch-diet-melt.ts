/**
 * Scratch diagnostic (not part of the test suite): what the `meanDiet` chart series
 * shows on a long run, and what moves it.
 *
 * `diet` is a genome trait fixed at birth (`buildPhenotype` in traits.ts), so a
 * falling population mean can only be a change in *who is alive*: either the
 * high-diet animals die out (the diet melt §6 describes) or their descendants
 * inherit a lower value. This measures both sides on the default world:
 *
 *   - the diet-class counts and `census.meanDiet` at every 250-tick window — the
 *     same numbers the charts panel now plots;
 *   - how every animal that was in a diet class at one report left the population
 *     by the next, with the cause inferred the way tests/scratch-carnivore-collapse.ts
 *     infers it (the engine tallies causes globally only);
 *   - what the newborns that replace them inherited, against their own parents' values.
 *
 *   npx vite-node tests/scratch-diet-melt.ts
 */
import { Simulation, type Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { dietClassOf } from '../src/sim/types'
import { TRAIT_INDEX } from '../src/sim/traits'

const TICKS = 3000
const REPORT_EVERY = 250
const STRICT = 0.66 // dietClassOf's carnivore edge (src/sim/types.ts)

type Exit = 'old age' | 'starvation' | 'conflict' | 'thermal stress' | 'predation (inferred)'

/** The engine's kill() tallies causes globally, so the reason has to be inferred. */
function inferExit(c: Creature): Exit {
  const ph = c.phenotype
  if (c.age >= ph.maxAge) return 'old age'
  if (Math.abs(c.localTemperature - ph.thermalOptimum) > ph.thermalTolerance) return 'thermal stress'
  if (c.energy < ph.maxEnergy * 0.1) return 'starvation'
  if (c.health < 0.5) return 'conflict'
  return 'predation (inferred)'
}

function mean(xs: number[]): number {
  if (!xs.length) return 0
  let out = 0
  for (const x of xs) out += x
  return out / xs.length
}

function tallyObject(tallies: Map<string, number>): string {
  const out: Record<string, number> = {}
  for (const [key, n] of [...tallies.entries()].sort((a, b) => b[1] - a[1])) out[key] = n
  return JSON.stringify(out)
}

function run(seed: string): void {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  console.log(`\n--- seed ${seed} ---`)

  const live = new Map<number, Creature>() // last live state of every animal still alive
  const inherited = new Map<number, number>() // every animal ever seen: its fixed diet value
  const exits = new Map<string, number>() // "<class> -> <inferred cause>" -> count
  const kidDiet: number[] = []
  const kidMidparent: number[] = []
  const strictKidDiet: number[] = []
  const strictKidMidparent: number[] = []

  const seen = new Set<number>()

  const report = (tick: number) => {
    const c = sim.lastCensus
    if (!c) return
    let rosterSum = 0
    for (const id of live.keys()) rosterSum += inherited.get(id) ?? 0
    const rosterMean = live.size ? rosterSum / live.size : 0
    console.log(
      `  tick ${String(tick).padStart(4)}  pop ${String(c.population).padStart(4)}` +
        `  herb ${String(c.herbivores).padStart(4)}  omni ${String(c.omnivores).padStart(4)}` +
        `  carn ${String(c.carnivores).padStart(3)}  mean diet ${c.meanDiet.toFixed(4)} (census)` +
        ` / ${rosterMean.toFixed(4)} (roster)`
    )
  }

  for (let tick = 1; tick <= TICKS; tick++) {
    sim.tickStep()
    seen.clear()
    for (const c of sim.creatures) {
      if (!c.alive) continue
      seen.add(c.id)
      live.set(c.id, c)
      if (inherited.has(c.id)) continue
      const diet = c.genome[TRAIT_INDEX.diet]
      inherited.set(c.id, diet)
      const [pa, pb] = sim.lineage.parentsOf(c.id)
      const da = pa >= 0 ? inherited.get(pa) : undefined
      const db = pb >= 0 ? inherited.get(pb) : undefined
      if (da === undefined || db === undefined) continue
      const midparent = (da + db) / 2
      kidDiet.push(diet)
      kidMidparent.push(midparent)
      if (midparent > STRICT) {
        strictKidDiet.push(diet)
        strictKidMidparent.push(midparent)
      }
    }
    for (const [id, c] of live) {
      if (seen.has(id)) continue
      const cls = dietClassOf(inherited.get(id) ?? 0)
      const key = `${cls} -> ${inferExit(c)}`
      exits.set(key, (exits.get(key) ?? 0) + 1)
      live.delete(id)
    }
    if (tick % REPORT_EVERY === 0) report(sim.tick)
  }

  console.log(`  exits by diet class and inferred cause: ${tallyObject(exits)}`)
  console.log(
    `  inheritance: ${kidDiet.length} newborns with both parents observed,` +
      ` inherited diet mean ${mean(kidDiet).toFixed(4)} vs mid-parent mean ${mean(kidMidparent).toFixed(4)}`
  )
  if (strictKidDiet.length) {
    const above = strictKidDiet.filter((d) => d > STRICT).length
    console.log(
      `    newborns of mid-parent > ${STRICT}: ${strictKidDiet.length}, inherited diet mean` +
        ` ${mean(strictKidDiet).toFixed(4)} vs mid-parent ${mean(strictKidMidparent).toFixed(4)},` +
        ` of which ${above} still above ${STRICT}`
    )
  }
  console.log(`  engine death tally: ${JSON.stringify(sim.deathsByCause)}`)
}

for (const seed of ['evolab', 'evolab-2', 'evolab-3']) run(seed)
