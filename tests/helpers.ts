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
  // The 48×48 world is 6.5% of the default world's area, so its founder load has
  // to be measured separately (tests/scratch-testconfig-ratio.ts). Three
  // carnivores on a 22-animal founding herd collapse this world to zero within
  // 1500 ticks on seeds probe-a and probe-b; one keeps every seed tested alive.
  config.population.founders = { herbivore: 15, omnivore: 4, carnivore: 1 }
  config.population.maxCreatures = 500
  return config
}

/**
 * How many founders the test configuration seeds. They are created first, so
 * creature ids `0 .. FOUNDER_COUNT - 1` are the founders and everything after
 * them is an offspring. Derived from the config so it cannot drift from it.
 */
export const FOUNDER_COUNT = Object.values(testConfig().population.founders).reduce(
  (total, count) => total + count,
  0
)

export function runSim(seed: string, ticks: number): Simulation {
  const sim = new Simulation(testConfig(seed))
  sim.run(ticks)
  return sim
}
