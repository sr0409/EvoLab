import { expect, it } from 'vitest'
import { Simulation, type SimulationState } from '../src/sim/engine'
import { testConfig } from './helpers'

/**
 * Determinism (PROGRESS milestone 5, item 2).
 *
 * The engine is fully seeded from `config.world.seed`. Two simulations built
 * from the same configuration must evolve to byte-identical persisted state,
 * and a save → load round-trip must reproduce the exact state and continue
 * deterministically.
 */

interface StateFingerprint {
  tick: number
  nextId: number
  ids: number[]
  speciesIds: number[]
  x: number[]
  y: number[]
  energy: number[]
  health: number[]
  age: number[]
  offspringCount: number[]
  genomes: number[]
  ledger: SimulationState['ledger']
  speciesSize: number
  parentA: number[]
  parentB: number[]
}

function fingerprint(sim: Simulation): StateFingerprint {
  const s = sim.toState()
  return {
    tick: s.tick,
    nextId: s.nextId,
    ids: Array.from(s.creatures.ids),
    speciesIds: Array.from(s.creatures.speciesIds),
    x: Array.from(s.creatures.x),
    y: Array.from(s.creatures.y),
    energy: Array.from(s.creatures.energy),
    health: Array.from(s.creatures.health),
    age: Array.from(s.creatures.age),
    offspringCount: Array.from(s.creatures.offspringCount),
    genomes: Array.from(s.creatures.genomes),
    ledger: s.ledger,
    speciesSize: sim.species.size,
    parentA: s.lineage.parentA,
    parentB: s.lineage.parentB
  }
}

it('the same seed produces byte-identical simulations', () => {
  const a = new Simulation(testConfig('determinism'))
  const b = new Simulation(testConfig('determinism'))
  a.run(100)
  b.run(100)

  const fa = fingerprint(a)
  const fb = fingerprint(b)
  expect(fa.tick).toBe(100)
  expect(fb.tick).toBe(100)
  expect(fa.nextId).toBe(fb.nextId)
  expect(fa.ids).toEqual(fb.ids)
  expect(fa.speciesIds).toEqual(fb.speciesIds)
  expect(fa.x).toEqual(fb.x)
  expect(fa.y).toEqual(fb.y)
  expect(fa.energy).toEqual(fb.energy)
  expect(fa.age).toEqual(fb.age)
  expect(fa.genomes).toEqual(fb.genomes)
  expect(fa.ledger).toEqual(fb.ledger)

  const auditA = a.auditEnergy()
  const auditB = b.auditEnergy()
  expect(auditA.biomass).toBe(auditB.biomass)
  expect(auditA.expected).toBe(auditB.expected)
}, 30000)

it('save → load round-trips the persisted state exactly', () => {
  const sim = new Simulation(testConfig('roundtrip'))
  sim.run(100)
  const before = sim.toState()
  const restored = Simulation.fromState(before)
  const again = restored.toState()

  expect(again.tick).toBe(before.tick)
  expect(again.nextId).toBe(before.nextId)
  expect(Array.from(again.creatures.ids)).toEqual(Array.from(before.creatures.ids))
  expect(Array.from(again.creatures.speciesIds)).toEqual(Array.from(before.creatures.speciesIds))
  expect(Array.from(again.creatures.x)).toEqual(Array.from(before.creatures.x))
  expect(Array.from(again.creatures.y)).toEqual(Array.from(before.creatures.y))
  expect(Array.from(again.creatures.energy)).toEqual(Array.from(before.creatures.energy))
  expect(Array.from(again.creatures.genomes)).toEqual(Array.from(before.creatures.genomes))
  expect(again.ledger).toEqual(before.ledger)
}, 30000)

it('two simulations restored from the same save evolve identically', () => {
  const sim = new Simulation(testConfig('resume'))
  sim.run(60)
  const state = sim.toState()

  const a = Simulation.fromState(state)
  const b = Simulation.fromState(state)
  a.run(40)
  b.run(40)

  const fa = fingerprint(a)
  const fb = fingerprint(b)
  expect(fa.tick).toBe(100)
  expect(fb.tick).toBe(100)
  expect(fa.ids).toEqual(fb.ids)
  expect(fa.energy).toEqual(fb.energy)
  expect(fa.genomes).toEqual(fb.genomes)
  expect(fa.ledger).toEqual(fb.ledger)
}, 30000)
