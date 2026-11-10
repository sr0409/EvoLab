import { describe, expect, it } from 'vitest'
import { Simulation, type Creature } from '../src/sim/engine'
import {
  JUVENILE_PLANT_ALLOWANCE_LIMITS,
  clampJuvenilePlantAllowance,
  defaultConfig,
  normalizeConfig,
  setJuvenilePlantAllowance
} from '../src/sim/config'
import {
  getSim,
  resetJuvenilePlantAllowance,
  setJuvenilePlantAllowance as setJuvenilePlantAllowanceControl,
  ui
} from '../src/store'
import { testConfig } from './helpers'

/**
 * The juvenile plant allowance knob (`config.predation.juvenilePlantAllowance`).
 * The engine's candidate (m) gives a strict-carnivore animal before maturity a
 * concession — eat plants — that scales down as its diet gene sits deeper in
 * the strict band. The knob multiplies that concession and the result is
 * capped at 1. At the default 1 the engine behaves exactly as committed
 * (§6D's measured (m) arm); at 0 every allowance branch sees zero and the
 * world is the pre-(m) baseline arm. Both anchors are pinned here by running
 * the configured engine against the same engine with the method patched to the
 * matching formula, and checking the two worlds agree.
 */

/** The committed §6D rule, written out here so the knob's default can be
 * compared against it without going through the engine's own implementation. */
function committedRule(c: Creature): number {
  const ph = c.phenotype
  if (ph.diet <= 0.66 || c.age >= ph.maturityAge) return 0
  return Math.max(0.2, Math.min(1, 1 - (ph.diet - 0.66) / 0.34))
}

/** The same rule with the multiplier applied the way the engine applies it. */
function scaledRule(multiplier: number): (c: Creature) => number {
  return (c) => {
    const base = committedRule(c)
    if (base === 0) return 0
    const scaled = base * multiplier
    return scaled > 1 ? 1 : scaled
  }
}

/** The engine's own allowance method, for calling and for replacing. */
function allowanceMethod(sim: Simulation): (c: Creature) => number {
  return (sim as unknown as { juvenilePlantAllowance: (c: Creature) => number })
    .juvenilePlantAllowance.bind(sim)
}

function patchAllowance(sim: Simulation, method: (c: Creature) => number): void {
  ;(sim as unknown as { juvenilePlantAllowance: (c: Creature) => number })
    .juvenilePlantAllowance = method
}

/** The default world at a given knob setting. The knob only has something to act
 * on in a world that keeps strict-band animals with young of their own: the
 * small test world's founding carnivore clan is gone inside a hundred ticks. The
 * default world is the one §8 step 3m measured the (m) A/B scan on. */
function defaultWorld(multiplier: number, seed: string): Simulation {
  const config = defaultConfig()
  config.world.seed = seed
  config.predation.juvenilePlantAllowance = multiplier
  return new Simulation(config)
}

/** Living members of the strict band (phenotype diet > 0.66), and how many of
 * them are under their own maturity age — the population the concession acts on. */
function bandCensus(sim: Simulation): { band: number; juveniles: number } {
  let band = 0
  let juveniles = 0
  for (const c of sim.creatures) {
    if (!c.alive) continue
    if (c.phenotype.diet <= 0.66) continue
    band++
    if (c.age < c.phenotype.maturityAge) juveniles++
  }
  return { band, juveniles }
}

function runWorld(seed: string, multiplier: number, ticks: number): Simulation {
  const config = testConfig(seed)
  config.predation.juvenilePlantAllowance = multiplier
  const sim = new Simulation(config)
  sim.run(ticks)
  return sim
}

/** A deterministic fingerprint of a finished world: the species ledger plus
 * who is standing in it. Two runs that should behave identically agree on it. */
function worldState(sim: Simulation): string {
  const alive = sim.creatures.filter((c) => c.alive).length
  return JSON.stringify({ alive, species: sim.species.snapshot().records })
}

describe('juvenile plant allowance clamping', () => {
  it('defaults to 1, the engine own committed rule', () => {
    const value = defaultConfig().predation.juvenilePlantAllowance
    expect(value).toBe(1)
    expect(clampJuvenilePlantAllowance(value)).toBe(1)
  })

  it('clamps the applied value to the design limits', () => {
    for (const value of [0, 0.5, 1, 1.5, 2]) {
      const config = testConfig('jpa-clamp')
      const applied = setJuvenilePlantAllowance(config, value)
      expect(applied).toBe(value)
      expect(config.predation.juvenilePlantAllowance).toBe(value)
    }

    const config = testConfig('jpa-clamp')
    expect(setJuvenilePlantAllowance(config, -2)).toBe(JUVENILE_PLANT_ALLOWANCE_LIMITS.min)
    expect(config.predation.juvenilePlantAllowance).toBe(JUVENILE_PLANT_ALLOWANCE_LIMITS.min)
    expect(setJuvenilePlantAllowance(config, 99)).toBe(JUVENILE_PLANT_ALLOWANCE_LIMITS.max)
    expect(config.predation.juvenilePlantAllowance).toBe(JUVENILE_PLANT_ALLOWANCE_LIMITS.max)
  })

  it('clamps the same way normalizeConfig does', () => {
    for (const value of [-1, 0, 0.5, 1, 1.5, 2, 99999]) {
      const viaNormalize = testConfig('jpa-normalize')
      viaNormalize.predation.juvenilePlantAllowance = value
      normalizeConfig(viaNormalize)
      const viaControl = testConfig('jpa-clamp')
      const applied = setJuvenilePlantAllowance(viaControl, value)
      expect(viaNormalize.predation.juvenilePlantAllowance).toBe(applied)
    }
  })

  it('backfills the default for a config predating the knob', () => {
    const legacy = testConfig('jpa-legacy')
    delete (legacy.predation as Partial<{ juvenilePlantAllowance: number }>)
      .juvenilePlantAllowance
    normalizeConfig(legacy)
    expect(legacy.predation.juvenilePlantAllowance).toBe(1)
  })
})

describe('the knob reproduces the engine rule it scales', () => {
  it('the default 1 reproduces the committed rule exactly', () => {
    const configured = runWorld('jpa-default', 1, 1200)
    const reference = new Simulation(testConfig('jpa-default'))
    patchAllowance(reference, committedRule)
    reference.run(1200)
    expect(worldState(configured)).toBe(worldState(reference))
  })

  it('the minimum 0 reproduces the pre-(m) baseline arm exactly', () => {
    const configured = runWorld('jpa-off', 0, 1200)
    const baseline = new Simulation(testConfig('jpa-off'))
    patchAllowance(baseline, () => 0)
    baseline.run(1200)
    expect(worldState(configured)).toBe(worldState(baseline))
  })

  it('a mid-range multiplier widens the concession', () => {
    const configured = runWorld('jpa-half', 0.5, 1000)
    const reference = new Simulation(testConfig('jpa-half'))
    patchAllowance(reference, scaledRule(0.5))
    reference.run(1000)
    expect(worldState(configured)).toBe(worldState(reference))
  })

  it('the concession is still capped at 1 at the maximum multiplier', () => {
    const config = testConfig('jpa-cap')
    config.predation.juvenilePlantAllowance = JUVENILE_PLANT_ALLOWANCE_LIMITS.max
    const sim = new Simulation(config)

    const allowance = allowanceMethod(sim)
    const juvenile = (diet: number): Creature =>
      ({ age: 1, phenotype: { diet, maturityAge: 500 } }) as unknown as Creature

    // diet 1.0: base 0.2 floor × 2 = 0.4.
    expect(allowance(juvenile(1))).toBeCloseTo(0.4)
    // diet 0.8: base 0.588 × 2 = 1.176, capped to 1.
    expect(allowance(juvenile(0.8))).toBe(1)
    // Not a strict carnivore, or past maturity: no concession at any setting.
    expect(allowance(juvenile(0.66))).toBe(0)
    const adult = { age: 999, phenotype: { diet: 1, maturityAge: 500 } } as unknown as Creature
    expect(allowance(adult)).toBe(0)
  })

  it(
    'moving the knob off 1 changes the world it runs',
    () => {
      // The concession only shows up in a world that has strict-band animals
      // with young of their own. The 48x48 test world never has any — its
      // founding carnivore clan is gone inside a hundred ticks — so this runs
      // the default world, the one §8 step 3m measured the (m) A/B scan on,
      // both arms stepped in lockstep so their censuses line up.
      const off = defaultWorld(0, 'evolab-3')
      const on = defaultWorld(1, 'evolab-3')

      let peakOff = 0
      let peakOn = 0
      let bandOff = 0
      let bandOn = 0
      let divergence = 0
      while (off.tick < 1000) {
        off.run(100)
        on.run(100)
        const a = bandCensus(off)
        const b = bandCensus(on)
        if (a.juveniles > peakOff) peakOff = a.juveniles
        if (b.juveniles > peakOn) peakOn = b.juveniles
        bandOff = a.band
        bandOn = b.band
        if (worldState(off) !== worldState(on) && divergence === 0) {
          divergence = off.tick
        }
      }

      // Three things have to be true for the knob to mean anything: the two
      // worlds' own records separate; at the census where they part, the
      // concession's world still has strict-band animals and the other does
      // not; and over the whole run the concession's world raises more
      // strict-band young than the world without it.
      expect(divergence).toBeGreaterThan(0)
      expect(bandOn).toBeGreaterThan(0)
      expect(bandOff).toBe(0)
      expect(peakOn).toBeGreaterThan(peakOff)
    },
    120_000
  )
})

describe('the juvenile plant allowance control', () => {
  it('sets the value on the running world and mirrors it in the UI state', () => {
    setJuvenilePlantAllowanceControl(0.5)
    expect(ui.juvenilePlantAllowance).toBe(0.5)
    expect(getSim().config.predation.juvenilePlantAllowance).toBe(0.5)

    setJuvenilePlantAllowanceControl(9)
    expect(ui.juvenilePlantAllowance).toBe(JUVENILE_PLANT_ALLOWANCE_LIMITS.max)
    expect(getSim().config.predation.juvenilePlantAllowance).toBe(
      JUVENILE_PLANT_ALLOWANCE_LIMITS.max
    )

    // A half-typed control-bar field arrives as NaN and lands on the minimum.
    setJuvenilePlantAllowanceControl(Number.NaN)
    expect(ui.juvenilePlantAllowance).toBe(JUVENILE_PLANT_ALLOWANCE_LIMITS.min)

    resetJuvenilePlantAllowance()
    expect(ui.juvenilePlantAllowance).toBe(defaultConfig().predation.juvenilePlantAllowance)
    expect(getSim().config.predation.juvenilePlantAllowance).toBe(1)
  })
})
