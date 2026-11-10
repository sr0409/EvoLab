import { describe, expect, it } from 'vitest'
import { LineageStore } from '../src/sim/lineage'
import { Rng } from '../src/sim/rng'
import {
  founderGenome,
  inherit,
  mutate,
  newGenome,
  TRAIT_COUNT,
  TRAIT_MAX,
  TRAIT_MIN
} from '../src/sim/traits'
import { FOUNDER_COUNT, runSim, testConfig } from './helpers'

/**
 * Inheritance, mutation and genealogy (milestone 5, item 4).
 *
 * Inheritance is crossover plus blending, so a child trait is always a convex
 * combination of the two parents' values; mutation may move a trait, but only
 * inside its declared range. The engine must record a complete, acyclic parent
 * link for every creature it creates.
 */

// Genomes are Float32Arrays; interval checks use a margin far below any real
// trait span but comfortably above float32 rounding.
const EPS = 1e-4

describe('inherit', () => {
  const rng = new Rng('inherit')
  const a = founderGenome(new Rng('parent-a'), 'herbivore')
  const b = founderGenome(new Rng('parent-b'), 'carnivore')

  it('keeps every child trait inside the interval spanned by its parents', () => {
    const out = newGenome()
    for (let trial = 0; trial < 2000; trial++) {
      inherit(rng, a, b, out)
      for (let i = 0; i < TRAIT_COUNT; i++) {
        expect(out[i]).toBeGreaterThanOrEqual(Math.min(a[i], b[i]) - EPS)
        expect(out[i]).toBeLessThanOrEqual(Math.max(a[i], b[i]) + EPS)
        expect(out[i]).toBeGreaterThanOrEqual(TRAIT_MIN[i] - EPS)
        expect(out[i]).toBeLessThanOrEqual(TRAIT_MAX[i] + EPS)
      }
    }
  })

  it('draws from both parents, and sometimes blends between them', () => {
    let fromA = 0
    let fromB = 0
    let blended = 0
    const out = newGenome()
    for (let trial = 0; trial < 2000; trial++) {
      inherit(rng, a, b, out)
      for (let i = 0; i < TRAIT_COUNT; i++) {
        if (a[i] === b[i]) continue
        const lo = Math.min(a[i], b[i])
        const hi = Math.max(a[i], b[i])
        if (out[i] <= lo + 1e-9) fromA++
        else if (out[i] >= hi - 1e-9) fromB++
        else if (out[i] > lo && out[i] < hi) blended++
      }
    }
    expect(fromA).toBeGreaterThan(0)
    expect(fromB).toBeGreaterThan(0)
    expect(blended).toBeGreaterThan(0)
  })
})

describe('mutate', () => {
  it('never moves a trait outside its declared range, even at extreme rates', () => {
    const rng = new Rng('mutate-bounds')
    for (let trial = 0; trial < 300; trial++) {
      const genome = founderGenome(rng, trial % 2 === 0 ? 'herbivore' : 'carnivore')
      for (let round = 0; round < 20; round++) {
        mutate(rng, genome, 1, 2)
        for (let i = 0; i < TRAIT_COUNT; i++) {
          expect(genome[i]).toBeGreaterThanOrEqual(TRAIT_MIN[i] - EPS)
          expect(genome[i]).toBeLessThanOrEqual(TRAIT_MAX[i] + EPS)
        }
      }
    }
  })

  it('introduces real variation at the engine rate, while most traits stay intact', () => {
    const rng = new Rng('mutate-rate')
    const rate = testConfig('mutate-rate').evolution.mutationRate
    const a = founderGenome(new Rng('mutate-a'), 'herbivore')
    const b = founderGenome(new Rng('mutate-b'), 'carnivore')

    const births = 2000
    let changedBirths = 0
    let changedTraits = 0
    const child = newGenome()
    for (let birth = 0; birth < births; birth++) {
      inherit(rng, a, b, child)
      const before = child.slice()
      const changed = mutate(rng, child, rate)
      if (changed > 0) changedBirths++
      changedTraits += changed
      for (let i = 0; i < TRAIT_COUNT; i++) {
        // Untouched traits keep their inherited value; mutated ones stay in range.
        if (child[i] !== before[i]) {
          expect(child[i]).toBeGreaterThanOrEqual(TRAIT_MIN[i] - EPS)
          expect(child[i]).toBeLessThanOrEqual(TRAIT_MAX[i] + EPS)
        }
      }
    }

    // Variation must actually happen at the configured rate...
    expect(changedBirths).toBeGreaterThan(births * 0.1)
    // ...but it is rare per trait, otherwise every birth would be a new species.
    expect(changedTraits).toBeLessThan(births * TRAIT_COUNT * 0.5)
  })
})

describe('LineageStore', () => {
  it('records parents and walks them back generation by generation', () => {
    const store = new LineageStore()
    for (let id = 0; id < 3; id++) store.add(id, -1, -1, 0, -1)
    store.add(10, 0, 1, 50, 1)
    store.add(11, 10, 2, 150, 2)

    expect(store.parentsOf(10)).toEqual([0, 1])
    expect(store.parentsOf(11)).toEqual([10, 2])

    const oneGeneration = new Set(store.ancestry(11, 1))
    expect(oneGeneration.has(10)).toBe(true)
    expect(oneGeneration.has(2)).toBe(true)

    const generations = new Set(store.ancestry(11, 2))
    expect(generations.has(10)).toBe(true)
    expect(generations.has(2)).toBe(true)
    expect(generations.has(0)).toBe(true)
    expect(generations.has(1)).toBe(true)

    expect(store.has(99)).toBe(false)
    expect(store.parentsOf(99)).toEqual([-1, -1])
  })

  it('trims the oldest lineages instead of growing without bound', () => {
    const maxRecords = 50
    const store = new LineageStore(16, maxRecords)
    for (let id = 0; id < 100; id++) {
      store.add(id, id >= 2 ? id - 2 : -1, id < 2 ? -1 : id - 1, id * 2, -1)
    }
    expect(store.count).toBe(100)
    expect(store.trimmedBefore).toBeGreaterThan(0)
    expect(store.count - store.trimmedBefore).toBeLessThanOrEqual(maxRecords)
    expect(store.has(store.trimmedBefore)).toBe(true)
    expect(store.has(store.trimmedBefore - 1)).toBe(false)
    // Surviving records still point at real parents.
    expect(store.parentsOf(99)).toEqual([97, 98])
  })
})

describe('engine genealogy', () => {
  // One 300-tick run serves every assertion in this block.
  const sim = runSim('lineage-engine', 300)

  it('registers every creature it ever created, founders first', () => {
    expect(sim.nextId).toBeGreaterThan(FOUNDER_COUNT) // real births happened
    expect(sim.lineage.count).toBe(sim.nextId)
  })

  it('founders have unknown parents; every other creature has both parents recorded', () => {
    for (let id = 0; id < sim.lineage.count; id++) {
      expect(sim.lineage.has(id)).toBe(true)
      const [a, b] = sim.lineage.parentsOf(id)
      if (id < FOUNDER_COUNT) {
        expect(a).toBe(-1)
        expect(b).toBe(-1)
      } else {
        expect(a).toBeGreaterThanOrEqual(0)
        expect(b).toBeGreaterThanOrEqual(0)
        expect(sim.lineage.has(a)).toBe(true)
        expect(sim.lineage.has(b)).toBe(true)
      }
    }
  })

  it('the genealogy is acyclic: parents are always born before their children', () => {
    for (let id = FOUNDER_COUNT; id < sim.lineage.count; id++) {
      const [a, b] = sim.lineage.parentsOf(id)
      expect(a).toBeLessThan(id)
      expect(b).toBeLessThan(id)
      expect(sim.lineage.birthTick[a]).toBeLessThan(sim.lineage.birthTick[id])
      expect(sim.lineage.birthTick[b]).toBeLessThan(sim.lineage.birthTick[id])
    }
  })

  it('every living offspring age agrees with its recorded birth tick', () => {
    let checked = 0
    for (const c of sim.creatures) {
      const [a] = sim.lineage.parentsOf(c.id)
      if (a < 0) continue // founders are seeded as adults; their age is synthetic
      expect(sim.lineage.birthTick[c.id]).toBe(sim.tick - c.age)
      checked++
    }
    expect(checked).toBeGreaterThan(0)
  })

  it('every genome in the population stays inside the trait ranges', () => {
    for (const c of sim.creatures) {
      for (let i = 0; i < TRAIT_COUNT; i++) {
        expect(c.genome[i]).toBeGreaterThanOrEqual(TRAIT_MIN[i] - EPS)
        expect(c.genome[i]).toBeLessThanOrEqual(TRAIT_MAX[i] + EPS)
      }
    }
  })
})
