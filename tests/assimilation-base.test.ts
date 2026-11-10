import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/engine'
import {
  ASSIMILATION_BASE_LIMITS,
  clampAssimilationBase,
  defaultConfig,
  normalizeConfig,
  setAssimilationBase,
  type SimConfig
} from '../src/sim/config'
import {
  getSim,
  resetAssimilationBase,
  setAssimilationBase as setAssimilationBaseControl,
  ui
} from '../src/store'
import { testConfig } from './helpers'

/**
 * The assimilation base: the fraction of a prey's body a predator's gut
 * absorbs, before that animal's gut-quality gene scales it. The engine's kill
 * path has always taken `0.45 + 0.45 · digest`, written out twice; both
 * places now read `config.predation.assimilationBase` through one helper, as
 * `assimilationBase · (1 + digest)`. The default 0.45 reproduces the old
 * constant exactly, so every measurement recorded in PROGRESS.md §6D remains
 * reproducible, and the knob is the intake side of the intake-vs-bill budget
 * §6B names as the constraint on strict carnivores.
 *
 * Absorption is capped at 1.0 at any setting: an animal takes at most the
 * energy its prey's body held, and the rest falls to litter where the prey
 * fell. That is what keeps the energy ledger closed at every knob position,
 * which is what the live run below checks.
 */

describe('assimilation base clamping', () => {
  it('keeps the default at the engine constant 0.45', () => {
    const value = defaultConfig().predation.assimilationBase
    expect(value).toBe(0.45)
    expect(clampAssimilationBase(value)).toBe(value)
  })

  it('clamps any requested value to the design limits', () => {
    const config = testConfig('assim-clamp')
    expect(setAssimilationBase(config, 5)).toBe(ASSIMILATION_BASE_LIMITS.max)
    expect(config.predation.assimilationBase).toBe(ASSIMILATION_BASE_LIMITS.max)
    expect(setAssimilationBase(config, -3)).toBe(ASSIMILATION_BASE_LIMITS.min)
    expect(config.predation.assimilationBase).toBe(ASSIMILATION_BASE_LIMITS.min)
    // A control-bar field half-typed by the user arrives as NaN; it must land
    // on a valid value rather than poison the config.
    expect(setAssimilationBase(config, Number.NaN)).toBe(ASSIMILATION_BASE_LIMITS.min)
    expect(setAssimilationBase(config, 0.7)).toBe(0.7)
    expect(config.predation.assimilationBase).toBe(0.7)
  })

  it('clamps the same way normalizeConfig does', () => {
    for (const value of [-3, 0, 0.45, 0.9, 0.91, 99999]) {
      const viaNormalize = testConfig('assim-normalize')
      viaNormalize.predation.assimilationBase = value
      normalizeConfig(viaNormalize)
      const viaControl = testConfig('assim-clamp')
      expect(setAssimilationBase(viaControl, value)).toBe(
        viaNormalize.predation.assimilationBase
      )
      expect(clampAssimilationBase(value)).toBe(viaNormalize.predation.assimilationBase)
    }
  })

  it('backfills the constant for a config saved before the knob existed', () => {
    // A snapshot saved before the predation section existed has none at all.
    // One saved after the floor key but before this one has the section with
    // the floor but no constant. Both must load as the engine's own 0.45 —
    // not as the control's minimum — so old snapshots keep behaving as the
    // measurements recorded with them.
    const none = testConfig('assim-legacy-none')
    delete (none as Partial<SimConfig>).predation
    normalizeConfig(none)
    expect(none.predation.assimilationBase).toBe(0.45)

    const partial = testConfig('assim-legacy-partial')
    delete (partial.predation as Partial<{ assimilationBase: number }>).assimilationBase
    normalizeConfig(partial)
    expect(partial.predation.assimilationBase).toBe(0.45)

    // An explicitly set value is never overwritten by the backfill.
    const saved = testConfig('assim-legacy-saved')
    saved.predation.assimilationBase = 0.6
    normalizeConfig(saved)
    expect(saved.predation.assimilationBase).toBe(0.6)
  })
})

describe('the assimilation base applied to a running world', () => {
  it('takes effect mid-run without restarting the world', () => {
    const sim = new Simulation(testConfig('assim-live'))
    sim.run(300)
    expect(sim.size).toBeGreaterThan(0)

    // At zero the hunt still happens and prey still die, but each kill
    // delivers nothing to the predator and the whole body falls to litter.
    sim.config.predation.assimilationBase = 0
    sim.run(200)
    expect(sim.config.predation.assimilationBase).toBe(0) // the same world, not a replaced one

    sim.config.predation.assimilationBase = ASSIMILATION_BASE_LIMITS.max
    sim.run(200)

    // The cap holds at every setting: energy is either taken by the predator
    // or left with the body, never conjured — so the ledger stays closed even
    // with the knob run to both extremes. Same margin as conservation.test.ts
    // (real drift is ~1e-4).
    const audit = sim.auditEnergy()
    expect(Math.abs(audit.delta)).toBeLessThan(0.05)
  })

  it('leaves a default world behaving exactly like the engine without the knob', () => {
    // The whole point of the default matching the old constant: the same seed
    // run through the same engine must be identical, and moving the knob away
    // from 0.45 must be observable in the same world.
    const a = new Simulation(testConfig('assim-parity'))
    const b = new Simulation(testConfig('assim-parity'))
    a.run(400)
    b.run(400)
    expect(a.size).toBe(b.size)
    expect(a.deathTotals()).toEqual(b.deathTotals())
  })
})

describe('the assimilation base control', () => {
  it('sets the value on the live simulation and mirrors what the UI shows', () => {
    setAssimilationBaseControl(0.6)
    expect(ui.assimilationBase).toBe(0.6)
    expect(getSim().config.predation.assimilationBase).toBe(0.6)

    setAssimilationBaseControl(5)
    expect(ui.assimilationBase).toBe(ASSIMILATION_BASE_LIMITS.max)
    expect(getSim().config.predation.assimilationBase).toBe(ASSIMILATION_BASE_LIMITS.max)

    // A half-typed control-bar field arrives as NaN and lands on the minimum.
    setAssimilationBaseControl(Number.NaN)
    expect(ui.assimilationBase).toBe(ASSIMILATION_BASE_LIMITS.min)

    resetAssimilationBase()
    expect(ui.assimilationBase).toBe(defaultConfig().predation.assimilationBase)
    expect(getSim().config.predation.assimilationBase).toBe(
      defaultConfig().predation.assimilationBase
    )
  })
})
