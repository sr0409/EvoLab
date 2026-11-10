import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

// Diagnostic scratch probe (not part of the test suite): founder loading ratio.
// With carnivores seeded inside the herd (candidate g kept), the band's hunt
// chain works — measured 0.060 kills per animal-tick — but the whole founding
// adult herd is harvested within ~130 band-ticks, while the first juvenile→
// adult recruitment lands at ~maturityAge ticks. The band starves in the gap.
// This probe varies only config.population.founders (a world-design knob) and
// measures whether a leaner carnivore load / larger founding herd bridges it.
//
//   npx tsx tests/scratch-founder-ratio.ts
const SEEDS = ['evolab', 'evolab-2', 'evolab-3']
const CHUNK = 250
const TICKS = 3000

interface Variant {
  label: string
  founders: { herbivore: number; omnivore: number; carnivore: number }
}

const VARIANTS: Variant[] = [
  { label: 'ratio-default-60/18/12', founders: { herbivore: 60, omnivore: 18, carnivore: 12 } },
  { label: 'ratio-lean-60/18/6', founders: { herbivore: 60, omnivore: 18, carnivore: 6 } },
  { label: 'ratio-leanest-60/18/4', founders: { herbivore: 60, omnivore: 18, carnivore: 4 } },
  { label: 'ratio-big-herd-120/18/12', founders: { herbivore: 120, omnivore: 18, carnivore: 12 } },
  { label: 'ratio-mixed-120/18/6', founders: { herbivore: 120, omnivore: 18, carnivore: 6 } }
]

function runVariant(v: Variant): void {
  for (const seed of SEEDS) {
    const config = defaultConfig()
    config.world.seed = seed
    config.population.founders = { ...config.population.founders, ...v.founders }
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
