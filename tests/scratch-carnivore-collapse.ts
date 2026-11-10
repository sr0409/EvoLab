/**
 * Scratch diagnostic (not part of the test suite): why does the carnivore band
 * reach the 3000-tick census on some seeds and not others under the committed
 * default? Founders seed as adults, so the interesting group is the cohort
 * they recruit. Tracks every carnivore-class animal individual by individual
 * and records how each one left the population, inferred from its last
 * observed state. Print-only.
 *
 *   npx vite-node tests/scratch-carnivore-collapse.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

const TICKS = 3000
const CHUNK = 250

type Exit = 'old age' | 'starvation' | 'thermal stress' | 'conflict' | 'predation (inferred)'

interface Snapshot {
  cohort: number
  age: number
  maxAge: number
  energy: number
  maxEnergy: number
  health: number
  temperature: number
  thermalOptimum: number
  thermalTolerance: number
}

function snapshot(c: Creature, seedTick: number): Snapshot {
  const ph = c.phenotype
  return {
    cohort: c.birthTick <= seedTick ? 0 : Math.floor((c.birthTick - seedTick - 1) / CHUNK) + 1,
    age: c.age,
    maxAge: ph.maxAge,
    energy: c.energy,
    maxEnergy: ph.maxEnergy,
    health: c.health,
    temperature: c.localTemperature,
    thermalOptimum: ph.thermalOptimum,
    thermalTolerance: ph.thermalTolerance,
  }
}

/** kill() only tallies causes globally, so an exit reason has to be inferred. */
function classify(s: Snapshot): Exit {
  if (s.age >= s.maxAge) return 'old age'
  if (Math.abs(s.temperature - s.thermalOptimum) > s.thermalTolerance) return 'thermal stress'
  if (s.energy < s.maxEnergy * 0.1) return 'starvation'
  if (s.health < 0.5) return 'conflict'
  return 'predation (inferred)'
}

function run(seed: string): void {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  const seedTick = sim.tick

  const tracked = new Map<number, Snapshot>()
  for (const c of sim.creatures) {
    if (c.alive && c.genome[TRAIT_INDEX.diet] > 0.4) tracked.set(c.id, snapshot(c, seedTick))
  }

  const exits = new Map<string, number>()
  const lines: string[] = []
  let maturePrey = 0

  for (let window = 1; window * CHUNK <= TICKS; window++) {
    for (let step = 0; step < CHUNK; step++) {
      sim.tickStep()
      const seen = new Set<number>()
      for (const c of sim.creatures) {
        if (!c.alive) continue
        const diet = c.genome[TRAIT_INDEX.diet]
        if (diet <= 0.4) {
          if (diet <= 0.75 && c.age >= c.phenotype.maturityAge) maturePrey += 1
          continue
        }
        tracked.set(c.id, snapshot(c, seedTick))
        seen.add(c.id)
      }
      for (const [id, prev] of tracked) {
        if (seen.has(id)) continue
        const key = `cohort ${prev.cohort} -> ${classify(prev)}`
        exits.set(key, (exits.get(key) ?? 0) + 1)
        tracked.delete(id)
      }
    }
    const byCohort = new Map<number, number>()
    for (const s of tracked.values()) byCohort.set(s.cohort, (byCohort.get(s.cohort) ?? 0) + 1)
    const parts = [...byCohort.entries()].sort((a, b) => a[0] - b[0])
      .map(([cohort, n]) => `c${cohort}=${n}`)
      .join(' ')
    lines.push(
      `  t${String(window * CHUNK).padStart(4)}: band=${String(tracked.size).padStart(3)} (${parts}) ` +
        `mature prey observed=${maturePrey}`,
    )
  }

  console.log(`\n--- seed ${seed} ---`)
  for (const line of lines) console.log(line)
  console.log('  exits, cohort 0 is the founding loading:')
  for (const key of [...exits.keys()].sort()) console.log(`    ${key}: ${exits.get(key)}`)
  console.log(`  global death tally: ${JSON.stringify(sim.deathTotals())}`)
}

console.log('carnivore cohort tracking under the committed default config')
for (const seed of ['evolab', 'evolab-2', 'evolab-3']) run(seed)
