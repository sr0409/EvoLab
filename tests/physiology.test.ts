import { describe, it } from 'vitest'
import {
  TRAITS,
  TRAIT_COUNT,
  TRAIT_INDEX,
  buildPhenotype,
  clampGenome,
  newGenome,
  type Genome
} from '../src/sim/traits'

/**
 * Prints the physiology the trait table produces for a plausible genome, so the
 * allometry can be checked against the intake an animal can actually achieve.
 *
 * The genome here is the founder archetype values blended by diet (herbivore
 * values at diet 0, carnivore values at diet 1) with body size and diet pinned
 * to the probe's parameters — no RNG, so the table is reproducible.
 */
function buildGenome(bodyLength: number, diet: number): Genome {
  const g = newGenome()
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const def = TRAITS[i]
    g[i] = def.founders.herbivore + (def.founders.carnivore - def.founders.herbivore) * diet
  }
  g[TRAIT_INDEX.size] = bodyLength
  g[TRAIT_INDEX.diet] = diet
  clampGenome(g)
  return g
}

describe('probe: physiology table', () => {
  it('reports intake and demand for representative genomes', () => {
    console.log('size  mass  basal  move  thermo  maxEnergy  bitePlant  bitePrey  digest')
    for (const bodyLength of [0.15, 0.3, 0.45, 0.7]) {
      for (const diet of [0, 0.5, 1]) {
        const genome = buildGenome(bodyLength, diet)
        const ph = buildPhenotype(genome)
        // The tick bill is dominated by basal + movement at typical speeds; the
        // bite sizes are the per-tick intake ceilings. These are the numbers the
        // food-web probe (scratch.test.ts) measures against real behaviour.
        const typicalMoveCost = ph.moveCostCoefficient * ph.speed * ph.speed
        console.log(
          `len=${bodyLength.toFixed(2)} diet=${diet.toFixed(1)} mass=${ph.mass.toFixed(3)} ` +
            `basal=${ph.basalRate.toFixed(4)} move@speed=${typicalMoveCost.toFixed(4)} ` +
            `maxEnergy=${ph.maxEnergy.toFixed(1)} bitePlant=${ph.bitePlant.toFixed(2)} ` +
            `bitePrey=${ph.bitePrey.toFixed(2)} digest=${ph.digest.toFixed(2)}`
        )
      }
    }
  })
})
