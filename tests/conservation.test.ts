import { expect, it } from 'vitest'
import { Simulation } from '../src/sim/engine'
import { testConfig } from './helpers'

/**
 * Energy conservation (PROGRESS milestone 5, item 1).
 *
 * The ledger identity — initial + photosynthesis − respirations − burial −
 * respiration = biomass + detritus + creature energy — must hold within a
 * floating-point tolerance over a long run. Magnitudes are calibrated by
 * tests/scratch-audit.ts: real drift stays below 1e-3 E even after 1000 ticks.
 */
function runChunked(seed: string, ticks: number) {
  const sim = new Simulation(testConfig(seed))
  let peakAbsDrift = 0
  for (let done = 0; done < ticks; done += 50) {
    sim.run(50)
    const audit = sim.auditEnergy()
    peakAbsDrift = Math.max(peakAbsDrift, Math.abs(audit.total - audit.expected))
  }
  return { sim, peakAbsDrift }
}

it('the energy ledger balances against the live pools over a long run', () => {
  const { peakAbsDrift } = runChunked('conservation-drift', 400)
  // Measured drift is ~1e-4; 0.05 is a two-orders-of-magnitude safety margin
  // while still catching any real bookkeeping bug.
  expect(peakAbsDrift).toBeLessThan(0.05)
}, 30000)

it('the audit reports exactly the sum of the energy pools', () => {
  const sim = new Simulation(testConfig('audit-pools'))
  sim.run(120)
  const audit = sim.auditEnergy()
  expect(audit.total).toBeCloseTo(audit.biomass + audit.detritus + audit.creatures, 6)
  expect(audit.creatures).toBeCloseTo(sim.totalCreatureEnergy(), 9)
}, 30000)

it('no energy pool goes negative', () => {
  const sim = new Simulation(testConfig('audit-negative'))
  for (let done = 0; done < 300; done += 50) {
    sim.run(50)
    const audit = sim.auditEnergy()
    expect(audit.biomass).toBeGreaterThanOrEqual(0)
    expect(audit.detritus).toBeGreaterThanOrEqual(0)
    expect(audit.creatures).toBeGreaterThanOrEqual(0)
    expect(sim.world.totalMineral()).toBeGreaterThanOrEqual(0)
    for (const c of sim.creatures) {
      expect(c.energy).toBeGreaterThanOrEqual(0)
      expect(c.health).toBeGreaterThanOrEqual(0)
      expect(c.minerals).toBeGreaterThanOrEqual(0)
    }
  }
}, 30000)
