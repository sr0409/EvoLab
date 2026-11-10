import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/engine'
import {
  MIN_PREY_ENERGY_LIMITS,
  clampMinPreyEnergy,
  defaultConfig,
  normalizeConfig,
  setMinPreyEnergy,
  type SimConfig
} from '../src/sim/config'
import {
  getSim,
  resetMinPreyEnergy,
  setMinPreyEnergy as setMinPreyEnergyControl,
  ui
} from '../src/store'
import { testConfig } from './helpers'

/**
 * The quarry-energy floor: the engine's `prey.energy > 0.2` predation gate
 * (engine.ts `preyIsLegal`) exposed as a live config knob
 * (`config.predation.minPreyEnergy`, "Prey energy floor" in the control bar).
 * PROGRESS.md §6E asks what happens when the floor is raised; these tests pin
 * the knob's behaviour so the experiment is reproducible and default-safe.
 *
 * The floor reshapes whom a hunter may chase; it never removes a living animal.
 * The engine reads the config value every tick, so it can be moved while a
 * world is running and takes effect on the next tick.
 */

describe('prey-energy floor clamping', () => {
  it('defaults to the engine gate 0.2', () => {
    const value = defaultConfig().predation.minPreyEnergy
    expect(value).toBe(0.2)
    expect(value).toBeGreaterThanOrEqual(MIN_PREY_ENERGY_LIMITS.min)
    expect(value).toBeLessThanOrEqual(MIN_PREY_ENERGY_LIMITS.max)
    expect(clampMinPreyEnergy(value)).toBe(value)
  })

  it('keeps any requested value inside the design limits', () => {
    const config = testConfig('mpe-clamp')
    expect(setMinPreyEnergy(config, 5)).toBe(MIN_PREY_ENERGY_LIMITS.max)
    expect(config.predation.minPreyEnergy).toBe(MIN_PREY_ENERGY_LIMITS.max)
    expect(setMinPreyEnergy(config, -5)).toBe(MIN_PREY_ENERGY_LIMITS.min)
    expect(config.predation.minPreyEnergy).toBe(MIN_PREY_ENERGY_LIMITS.min)
    // A control-bar field the user half-typed arrives as NaN.
    expect(setMinPreyEnergy(config, Number.NaN)).toBe(MIN_PREY_ENERGY_LIMITS.min)
    expect(setMinPreyEnergy(config, 0.35)).toBe(0.35)
    expect(config.predation.minPreyEnergy).toBe(0.35)
  })

  it('clamps the same way normalizeConfig does', () => {
    for (const value of [-50, 0, 0.2, 0.9, 0.91, 99999]) {
      const viaNormalize = testConfig('mpe-normalize')
      viaNormalize.predation.minPreyEnergy = value
      normalizeConfig(viaNormalize)
      const viaControl = testConfig('mpe-clamp')
      expect(setMinPreyEnergy(viaControl, value)).toBe(viaNormalize.predation.minPreyEnergy)
      expect(clampMinPreyEnergy(value)).toBe(viaNormalize.predation.minPreyEnergy)
    }
  })

  it('backfills the gate for a config saved before the knob existed', () => {
    // Snapshots saved before this knob existed carry no predation section at
    // all. Loading one must restore the engine's own gate rather than leave
    // the engine reading an undefined floor.
    const config = testConfig('mpe-legacy')
    delete (config as Partial<SimConfig>).predation
    normalizeConfig(config)
    expect(config.predation?.minPreyEnergy).toBe(0.2)
  })
})

describe('prey-energy floor set on a running world', () => {
  it('applies mid-run without restarting the world', () => {
    const sim = new Simulation(testConfig('mpe-live'))
    sim.run(300)
    const atRaise = sim.size
    expect(atRaise).toBeGreaterThan(0)

    sim.config.predation.minPreyEnergy = 0.7
    expect(sim.tick).toBe(300) // the same world, not a restarted one
    sim.run(300)
    // The floor changes whom a hunter may chase; it never removes a creature.
    expect(sim.config.predation.minPreyEnergy).toBe(0.7)

    sim.config.predation.minPreyEnergy = 0.2
    sim.run(100)
    expect(sim.size).toBeGreaterThan(0)
  })
})

describe('the min-prey-energy control', () => {
  it('sets the floor on the live simulation and mirrors what the UI shows', () => {
    setMinPreyEnergyControl(0.6)
    expect(ui.minPreyEnergy).toBe(0.6)
    expect(getSim().config.predation.minPreyEnergy).toBe(0.6)

    setMinPreyEnergyControl(5)
    expect(ui.minPreyEnergy).toBe(MIN_PREY_ENERGY_LIMITS.max)
    expect(getSim().config.predation.minPreyEnergy).toBe(MIN_PREY_ENERGY_LIMITS.max)

    // A half-typed control-bar field arrives as NaN and lands on the minimum.
    setMinPreyEnergyControl(Number.NaN)
    expect(ui.minPreyEnergy).toBe(MIN_PREY_ENERGY_LIMITS.min)

    resetMinPreyEnergy()
    expect(ui.minPreyEnergy).toBe(defaultConfig().predation.minPreyEnergy)
    expect(getSim().config.predation.minPreyEnergy).toBe(defaultConfig().predation.minPreyEnergy)
  })
})
