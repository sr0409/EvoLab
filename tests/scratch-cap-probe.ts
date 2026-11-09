/**
 * Throwaway diagnostic: what does changing the population ceiling on a RUNNING
 * world actually do? The engine reads config.population.maxCreatures every tick,
 * so the control bar's "Population cap" field can retune the ceiling mid-run.
 * This probe measures the test world with the ceiling lowered partway through,
 * and then raised again, on the seeds the engine tests use.
 *
 * Run with:  npx vite-node tests/scratch-cap-probe.ts
 */
import { Simulation } from '../src/sim/engine'
import { setPopulationCap } from '../src/sim/config'
import { testConfig } from './helpers'

const EVERY = 100

function probe(seed: string, lowerAt: number, lowerTo: number, raiseAt: number, raiseTo: number): void {
  const sim = new Simulation(testConfig(seed))
  const out = [`seed ${seed}  start ceiling ${sim.config.population.maxCreatures}`]
  const marks: number[] = []
  for (let tick = EVERY; tick <= 2000; tick += EVERY) {
    if (tick === lowerAt) {
      setPopulationCap(sim.config, lowerTo)
      marks.push(tick)
    }
    if (tick === raiseAt) {
      setPopulationCap(sim.config, raiseTo)
      marks.push(tick)
    }
    sim.run(EVERY)
    out.push(`${tick}:${sim.size}${marks.includes(tick) ? '*' : ''}`)
  }
  console.log(out.join('  '))
}

for (const seed of ['probe-a', 'probe-b']) {
  probe(seed, 400, 150, 0, 150) // lowered only
  probe(seed, 800, 60, 1300, 500) // lowered hard, then raised again
}
