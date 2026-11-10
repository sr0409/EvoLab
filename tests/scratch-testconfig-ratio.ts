import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

// Diagnostic scratch probe (not part of the test suite): the same founder-ratio
// question as tests/scratch-founder-ratio.ts, on the 48×48 configuration the
// unit tests share (tests/helpers.ts). That world is 6.5% of the default world's
// area with a 500-creature ceiling, so the founder load that keeps a large world
// alive does not transfer directly; the ratio has to be measured here too.
// With carnivores seeded inside the herd (candidate g) the test world on seed
// probe-a collapses at 15/4/3, which is what broke the milestone-5 population
// tests. This probe varies only config.population.founders.
//
//   npx vite-node tests/scratch-testconfig-ratio.ts
const SEEDS = ['probe-a', 'probe-b', 'probe-c', 'evolab-test']
const CHUNK = 250
const TICKS = 1500

interface Variant {
  label: string
  founders: { herbivore: number; omnivore: number; carnivore: number }
}

const VARIANTS: Variant[] = [
  { label: 'test-15/4/3 (current)', founders: { herbivore: 15, omnivore: 4, carnivore: 3 } },
  { label: 'test-15/4/1', founders: { herbivore: 15, omnivore: 4, carnivore: 1 } },
  { label: 'test-15/4/2', founders: { herbivore: 15, omnivore: 4, carnivore: 2 } },
  { label: 'test-30/8/2', founders: { herbivore: 30, omnivore: 8, carnivore: 2 } },
  { label: 'test-30/9/1', founders: { herbivore: 30, omnivore: 9, carnivore: 1 } },
  { label: 'test-40/6/2', founders: { herbivore: 40, omnivore: 6, carnivore: 2 } },
  { label: 'test-45/9/3 (120/18/6 scaled)', founders: { herbivore: 45, omnivore: 9, carnivore: 3 } }
]

function runVariant(v: Variant): void {
  for (const seed of SEEDS) {
    const config = defaultConfig()
    config.world.seed = seed
    config.world.width = 48
    config.world.height = 48
    config.population.founders = { ...v.founders }
    config.population.maxCreatures = 500
    const sim = new Simulation(config)

    const founderIds = new Set<number>()
    for (const c of sim.creatures) {
      if (c.alive && c.genome[TRAIT_INDEX.diet] > 0.66) founderIds.add(c.id)
    }

    const founderBand: number[] = []
    const carnivoreBand: number[] = []
    const population: number[] = []
    for (let tick = CHUNK; tick <= TICKS; tick += CHUNK) {
      sim.run(CHUNK)
      let foundersAlive = 0
      let bandCount = 0
      let populationCount = 0
      for (const c of sim.creatures) {
        if (!c.alive) continue
        populationCount += 1
        if (c.genome[TRAIT_INDEX.diet] > 0.66) {
          bandCount += 1
          if (founderIds.has(c.id)) foundersAlive += 1
        }
      }
      founderBand.push(foundersAlive)
      carnivoreBand.push(bandCount)
      population.push(populationCount)
    }

    console.log(
      `${v.label} seed=${seed} founders=${founderIds.size} ` +
        `founderBand=[${founderBand.join(',')}] ` +
        `carnivoreBand=[${carnivoreBand.join(',')}] ` +
        `population=[${population.join(',')}] ` +
        `deaths=${JSON.stringify(sim.deathsByCause)}`
    )
  }
}

for (const v of VARIANTS) runVariant(v)
