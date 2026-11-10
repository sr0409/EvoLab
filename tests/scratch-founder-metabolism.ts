import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAITS, TRAIT_INDEX } from '../src/sim/traits'

// Diagnostic scratch probe (not part of the test suite): founder carnivore
// band survival against the founder metabolic load. Used for the candidate
// records in PROGRESS.md section 6.
//
//   npx tsx tests/scratch-founder-metabolism.ts
//
// Candidate under test: seed the carnivore founders with a lower metabolic load
// (traits.ts founders.carnivore for 'metabolism'), so the band's energy need
// drops while its hunting behaviour is untouched. Measure whether the band
// survives 3000 world ticks on the default world.
const SEEDS = ['evolab', 'evolab-2', 'evolab-3']
const CHUNK = 250
const TICKS = 3000

const metabolismSpec = TRAITS[TRAIT_INDEX.metabolism]

function runVariant(label: string, founderMetabolism: number): void {
  metabolismSpec.founders = { ...metabolismSpec.founders, carnivore: founderMetabolism }
  for (const seed of SEEDS) {
    const config = defaultConfig()
    config.world.seed = seed
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
      `${label} seed=${seed} founders=${founderIds.size} ` +
        `founderBand=[${founderBand.join(',')}] ` +
        `carnivoreBandAtEnd=${carnivoreBand[carnivoreBand.length - 1]} ` +
        `populationAtEnd=${population[population.length - 1]} ` +
        `deaths=${JSON.stringify(sim.deathsByCause)}`
    )
  }
}

runVariant('baseline-founder-metabolism-1.15', 1.15)
runVariant('candidate-founder-metabolism-0.8', 0.8)
