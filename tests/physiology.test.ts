import { describe, it } from 'vitest'
import { buildPhenotype, describeGenome } from '../src/sim/traits'
import { defaultConfig } from '../src/sim/config'

/**
 * Prints the physiology the trait table produces for a plausible genome, so the
 * allometry can be checked against the intake an animal can actually achieve.
 */
describe('probe: physiology table', () => {
  it('reports intake and demand for representative genomes', () => {
    const worldConfig = defaultConfig().world
    void worldConfig
    console.log('size  mass  basal  move  thermo  maxEnergy  bitePlant  need/tick')
    for (const bodyLength of [0.15, 0.3, 0.45, 0.6, 0.7]) {
      for (const diet of [0, 0.5, 1]) {
        for (const gut of [0, 1]) {
          const genome = buildGenome(bodyLength, diet)
          const ph = buildPhenotype(genome)
          console.log(
            `len=${bodyLength.toFixed(2)} diet=${diet.toFixed(1)} mass=${ph.mass.toFixed(3)} ` +
              `basal=${ph.basalRate.toFixed(4)} maxEnergy=${ph.maxEnergy.toFixed(1)} ` +
              `intake=${ph.maxIntake.toFixed(2)} gut=${ph.gut.toFixed(2)} assimile=${(ph.intakeRate * ph.gut).toFixed(2)}`
          )
        }
      }
    }
  })
})
