import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/engine'
import {
  POPULATION_CAP_LIMITS,
  clampPopulationCap,
  defaultConfig,
  normalizeConfig,
  setPopulationCap
} from '../src/sim/config'
import { setPopulationCap as setLiveCap, getSim, ui } from '../src/store'
import { testConfig } from './helpers'

/**
 * The population ceiling and the control that sets it by hand (config.population
 * .maxCreatures, "Population cap" in the control bar).
 *
 * The ceiling is a modelling limit, not biology: the engine consults it when it
 * decides whether a mated pair may breed, so it can be changed while a world is
 * running and takes effect on the next tick. Changing it never removes a living
 * creature — a population above a newly lowered ceiling stops breeding and comes
 * back down through ordinary deaths, which is what these runs measure.
 * The trajectories are reproduced by tests/scratch-cap-probe.ts.
 */

describe('population ceiling clamping', () => {
  it('keeps any requested value inside the design limits', () => {
    const config = testConfig('cap-clamp')
    expect(setPopulationCap(config, 9000)).toBe(POPULATION_CAP_LIMITS.max)
    expect(config.population.maxCreatures).toBe(POPULATION_CAP_LIMITS.max)
    expect(setPopulationCap(config, 3)).toBe(POPULATION_CAP_LIMITS.min)
    expect(config.population.maxCreatures).toBe(POPULATION_CAP_LIMITS.min)
    // A control bar field the user left empty or half-typed arrives as NaN.
    expect(setPopulationCap(config, Number.NaN)).toBe(POPULATION_CAP_LIMITS.min)
    expect(setPopulationCap(config, 1234.6)).toBe(1235)
  })

  it('clamps the same way normalizeConfig does', () => {
    for (const value of [-50, 0, 19, 20, 20.4, 4000, 4001, 99999]) {
      const viaNormalize = testConfig('cap-normalize')
      viaNormalize.population.maxCreatures = value
      normalizeConfig(viaNormalize)
      const viaControl = testConfig('cap-normalize')
      expect(setPopulationCap(viaControl, value)).toBe(viaNormalize.population.maxCreatures)
      expect(clampPopulationCap(value)).toBe(viaNormalize.population.maxCreatures)
    }
  })

  it('the default ceiling sits inside the limits the control may set', () => {
    const value = defaultConfig().population.maxCreatures
    expect(value).toBe(3200)
    expect(value).toBeLessThanOrEqual(POPULATION_CAP_LIMITS.max)
    expect(clampPopulationCap(value)).toBe(value)
  })
})

describe('population ceiling set on a running world', () => {
  it('lowers the ceiling mid-run: the population stops growing and settles under it', () => {
    const sim = new Simulation(testConfig('probe-a'))
    sim.run(300)
    const before = sim.size // measured 177 on this seed
    expect(before).toBeGreaterThan(150)

    setPopulationCap(sim.config, 150)
    expect(sim.tick).toBe(300) // the world itself was not restarted
    expect(sim.config.population.maxCreatures).toBe(150)

    // Nothing is culled: measured, the population holds at or below what it
    // already was and settles just over the new ceiling (measured 150-152).
    let peak = sim.size
    for (let step = 0; step < 8; step++) {
      sim.run(100)
      peak = Math.max(peak, sim.size)
      expect(sim.size).toBeGreaterThan(0)
    }
    expect(peak).toBeLessThanOrEqual(before)
    expect(sim.size).toBeLessThanOrEqual(150 + 20)
  })

  it('raising the ceiling mid-run lets the world grow again', () => {
    const sim = new Simulation(testConfig('probe-a'))
    sim.run(700)
    const atTestCeiling = sim.size // measured ~500, the test configuration's ceiling
    expect(atTestCeiling).toBeGreaterThan(200)

    setPopulationCap(sim.config, 60)
    sim.run(500)
    const suppressed = sim.size // measured a steady decline towards the new ceiling
    expect(suppressed).toBeLessThan(atTestCeiling)

    setPopulationCap(sim.config, testConfig('probe-a').population.maxCreatures)
    sim.run(300)
    expect(sim.size).toBeGreaterThan(suppressed) // breeding resumed, no restart
  })
})

describe('the population ceiling control in the store', () => {
  it('applies the requested ceiling to the live simulation and shows it', () => {
    setLiveCap(1500)
    expect(ui.populationCap).toBe(1500)
    expect(getSim().config.population.maxCreatures).toBe(1500)

    setLiveCap(9000) // out of range: the UI shows what the engine is running
    expect(ui.populationCap).toBe(POPULATION_CAP_LIMITS.max)
    expect(getSim().config.population.maxCreatures).toBe(POPULATION_CAP_LIMITS.max)

    setLiveCap(Number.NaN)
    expect(ui.populationCap).toBe(POPULATION_CAP_LIMITS.min)
    expect(getSim().config.population.maxCreatures).toBe(POPULATION_CAP_LIMITS.min)

    setLiveCap(defaultConfig().population.maxCreatures) // leave the default in place
  })
})
