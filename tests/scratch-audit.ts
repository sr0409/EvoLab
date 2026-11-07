import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'

/**
 * Diagnostic (not an assertion test): shows how the energy audit drifts over a
 * long run on a small world, and when breeding starts, so the conservation /
 * inheritance tests can assert against measured magnitudes.
 *
 * Run with: npx vite-node tests/scratch-audit.ts
 */
function probe(seed: string, ticks: number) {
  const config = defaultConfig()
  config.world.seed = seed
  config.world.width = 48
  config.world.height = 48
  config.population.founders = { herbivore: 15, omnivore: 4, carnivore: 3 }
  config.population.maxCreatures = 500

  const sim = new Simulation(config)
  console.log(`--- probe ${seed} (${ticks} ticks) ---`)
  console.log('tick  pop  herb/omni/carn      total      expected       delta       births deaths')
  for (let done = 0; done <= ticks; done += 50) {
    if (done > 0) sim.run(50)
    const audit = sim.auditEnergy()
    const census = sim.lastCensus
    let born = 0
    for (let id = 0; id < sim.lineage.count; id++) {
      const [a] = sim.lineage.parentsOf(id)
      if (a >= 0) born++
    }
    console.log(
      String(sim.tick).padStart(4),
      String(sim.creatures.length).padStart(5),
      audit.biomass.toFixed(0).padStart(6),
      audit.detritus.toFixed(0).padStart(8),
      audit.creatures.toFixed(0).padStart(8),
      audit.total.toFixed(1).padStart(12),
      audit.expected.toFixed(1).padStart(12),
      audit.delta.toFixed(4).padStart(12),
      String(born).padStart(6),
      String(census?.deaths ?? 0).padStart(6)
    )
  }
  if (sim.lastCensus) {
    console.log(
      'census diet counts:',
      sim.lastCensus.herbivores,
      sim.lastCensus.omnivores,
      sim.lastCensus.carnivores,
      'species:',
      sim.species.size
    )
  }
}

probe('probe-a', 400)
probe('probe-a', 1000)
