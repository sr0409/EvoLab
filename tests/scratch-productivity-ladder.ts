/**
 * Scratch diagnostic — §8 step 3.j, candidate (k): lower primary productivity, keep the cap.
 *
 * Every candidate so far failed at the same point: the band overshoots, the population returns to
 * the 3200 ceiling, and the band disappears there. §6C established that the ceiling — not the
 * environment — is what currently sets the population number. This probe holds the ceiling fixed at
 * 3200 and turns down the two dials plant growth actually reads: `environment.sunlight` (the
 * multiplier on gross plant growth in `world.ts`) and `environment.rainfall` (its wetness term).
 * For each rung it asks the §8 acceptance question directly on the three reference seeds: does the
 * world settle below 3200 on its own, and does a strict carnivore band (inherited diet > 0.66)
 * then reach tick 3000?
 *
 *   npx vite-node tests/scratch-productivity-ladder.ts
 */
import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

const TICKS = 3000
const CHUNK = 250
const STRICT = 0.66

interface Variant {
  readonly label: string
  readonly sunlight: number
  readonly rainfall: number
}

const VARIANTS: readonly Variant[] = [
  { label: 'baseline sun 1.00 rain 1.00', sunlight: 1.0, rainfall: 1.0 },
  { label: 'sun 0.85', sunlight: 0.85, rainfall: 1.0 },
  { label: 'sun 0.70', sunlight: 0.7, rainfall: 1.0 },
  { label: 'sun 0.55', sunlight: 0.55, rainfall: 1.0 },
  { label: 'famine preset sun 0.42 rain 0.62', sunlight: 0.42, rainfall: 0.62 },
]

const SEEDS: readonly string[] = ['evolab', 'evolab-2', 'evolab-3']

interface Census {
  total: number
  strict: number
}

function census(sim: Simulation): Census {
  let total = 0
  let strict = 0
  for (const c of sim.creatures) {
    if (!c.alive) continue
    total++
    if (c.genome[TRAIT_INDEX.diet] > STRICT) strict++
  }
  return { total, strict }
}

interface Result {
  readonly label: string
  readonly seed: string
  readonly peak: number
  readonly finalPopulation: number
  readonly finalStrict: number
  /** censuses in the last 2500 ticks pinned at/above 99% of the cap */
  readonly cappedWindows: number
}

function run(variant: Variant, seed: string): Result {
  const config = defaultConfig()
  config.world.seed = seed
  config.environment.sunlight = variant.sunlight
  config.environment.rainfall = variant.rainfall
  const sim = new Simulation(config)

  const populations: number[] = []
  const stricts: number[] = []
  let capped = 0
  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    const c = census(sim)
    populations.push(c.total)
    stricts.push(c.strict)
    if (window >= 4 && c.total >= 3200 * 0.99) capped++
  }

  let peak = 0
  for (const total of populations) if (total > peak) peak = total

  console.log(`\n--- ${variant.label} / seed ${seed} ---`)
  for (let i = 0; i < populations.length; i++) {
    console.log(
      `  t${String((i + 1) * CHUNK).padStart(4)}: population=${String(populations[i]).padStart(4)} ` +
        `strict=${String(stricts[i]).padStart(4)}`,
    )
  }
  const final = populations.length - 1
  console.log(`  peak=${peak}; capped windows (of ${populations.length - 3}): ${capped}`)
  return {
    label: variant.label,
    seed,
    peak,
    finalPopulation: populations[final] ?? 0,
    finalStrict: stricts[final] ?? 0,
    cappedWindows: capped,
  }
}

const results: Result[] = []
for (const variant of VARIANTS) {
  for (const seed of SEEDS) {
    results.push(run(variant, seed))
  }
}

console.log('\n================ summary: 3 seeds per rung ================')
for (const variant of VARIANTS) {
  const rs = results.filter((r) => r.label === variant.label)
  const settled = rs.filter((r) => r.cappedWindows === 0).length
  const withBand = rs.filter((r) => r.finalStrict > 0).length
  const collapsed = rs.filter((r) => r.finalPopulation < 5).length
  console.log(
    `${variant.label.padEnd(34)} settled below cap: ${settled}/3  ` +
      `band at 3000: ${withBand}/3  collapsed: ${collapsed}/3  ` +
      `final strict per seed: ${rs.map((r) => String(r.finalStrict).padStart(4)).join(' ')}`,
  )
}
