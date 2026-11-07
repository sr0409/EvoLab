import { Simulation } from '../src/sim/engine'
import { defaultConfig, type SimConfig } from '../src/sim/config'


/**
 * Shared test configuration: a small world with a small founder herd so
 * engine-level tests finish in a couple of seconds while still producing
 * births, deaths, speciation and a real energy ledger.
 */
export function testConfig(seed = 'evolab-test'): SimConfig {
  const config = defaultConfig()
  config.world.seed = seed
  config.world.width = 48
  config.world.height = 48
  config.population.founders = { herbivore: 15, omnivore: 4, carnivore: 3 }
  config.population.maxCreatures = 500
  return config
}

export function runSim(seed: string, ticks: number): Simulation {
  const sim = new Simulation(testConfig(seed))
  sim.run(ticks)
  return sim
}
