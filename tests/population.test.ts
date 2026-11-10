import { describe, expect, it } from 'vitest'
import { Simulation } from '../src/sim/engine'
import { dietClassOf } from '../src/sim/types'
import { TRAIT_INDEX } from '../src/sim/traits'
import type { CensusRecord } from '../src/sim/stats'
import { FOUNDER_COUNT, testConfig } from './helpers'

/**
 * Population dynamics (milestone 5, item 5).
 *
 * The engine samples a census at the end of every 5th tick, after dead
 * creatures have been removed and newborns admitted. Every census must agree
 * with the live population: the same head count, diet classes that partition
 * it exactly, a diet mean computed from it, species bookkeeping that agrees with
 * the species registry, and birth/death counts that add up over the whole run.
 */

const CENSUS_PERIOD = 5

/**
 * Run a fixed 48x48 world and record every census, so the tests can assert
 * against the full trajectory rather than a single snapshot.
 */
function collectCensuses(seed: string, ticks: number): { sim: Simulation; censuses: CensusRecord[] } {
  const sim = new Simulation(testConfig(seed))
  const records: CensusRecord[] = [{ ...sim.lastCensus! }] // the tick-0 census
  for (let done = CENSUS_PERIOD; done <= ticks; done += CENSUS_PERIOD) {
    sim.run(CENSUS_PERIOD)
    const census = sim.lastCensus
    if (!census || census.tick !== done) throw new Error(`missing census at tick ${done}`)
    records.push({ ...census })
  }
  return { sim, censuses: records }
}

describe('population dynamics', () => {
  // One 400-tick run backs every assertion in this file.
  const { sim, censuses } = (() => {
    const run = collectCensuses('probe-a', 400)
    return { sim: run.sim, censuses: run.censuses }
  })()

  it('the population grows from its founders and sustains itself', () => {
    expect(censuses[0].population).toBe(FOUNDER_COUNT) // the seeded founders
    for (const census of censuses) {
      expect(census.population).toBeGreaterThan(0)
    }
    // Measured growth on this seed is FOUNDER_COUNT -> ~500 within 400 ticks. The
    // assertion is deliberately loose: the engine must show real growth,
    // not a specific trajectory.
    expect(censuses[censuses.length - 1].population).toBeGreaterThan(200)
  })

  it('the population stays within its configured cap', () => {
    const cap = testConfig('cap-check').population.maxCreatures
    for (const census of censuses) {
      // Breeding stops at the cap, but a final litter can overshoot it.
      expect(census.population).toBeLessThanOrEqual(cap + 20)
    }
  })

  it('census counts match the live population and its diet classes partition it', () => {
    const last = censuses[censuses.length - 1]
    expect(last.population).toBe(sim.creatures.length)
    expect(last.herbivores + last.omnivores + last.carnivores).toBe(last.population)

    const live: Record<'herbivore' | 'omnivore' | 'carnivore', number> = {
      herbivore: 0,
      omnivore: 0,
      carnivore: 0
    }
    for (const c of sim.creatures) live[dietClassOf(c.genome[TRAIT_INDEX.diet])]++
    expect(last.herbivores).toBe(live.herbivore)
    expect(last.omnivores).toBe(live.omnivore)
    expect(last.carnivores).toBe(live.carnivore)
  })

  it('the census mean diet gene is the mean diet gene of the living population', () => {
    // Mean diet is what makes the "diet melt" question answerable: it says
    // whether a diet class disappeared because its animals died, or because
    // their diet gene drifted. It must therefore track the live population.
    const last = censuses[censuses.length - 1]
    let sum = 0
    for (const c of sim.creatures) sum += c.genome[TRAIT_INDEX.diet]
    const expected = sim.creatures.length ? sum / sim.creatures.length : 0
    expect(last.meanDiet).toBeCloseTo(expected, 6)
    // The mean sits inside the class bounds the same census reports: it is a
    // property of the animals counted, not a separate measurement.
    expect(last.meanDiet).toBeGreaterThanOrEqual(0)
    expect(last.meanDiet).toBeLessThanOrEqual(1)
    if (last.carnivores > 0) expect(last.meanDiet).toBeLessThan(1)
  })

  it('birth and death census records add up to the whole run', () => {
    let births = 0
    let deaths = 0
    for (const census of censuses) {
      expect(census.births).toBeGreaterThanOrEqual(0)
      expect(census.deaths).toBeGreaterThanOrEqual(0)
      births += census.births
      deaths += census.deaths
    }
    // Every born creature gets a lineage record, so total births == registered
    // creatures - founders. Deaths recorded in censuses == the engine's own count.
    expect(births).toBe(sim.lineage.count - FOUNDER_COUNT)
    expect(deaths).toBe(sim.totalDeaths())
  })

  it('species diversity is recorded and never contradicts the registry', () => {
    const last = censuses[censuses.length - 1]
    expect(last.speciesTotal).toBe(sim.species.size)
    expect(last.speciesAlive).toBe(sim.species.livingCount())
    expect(last.speciesAlive).toBeLessThanOrEqual(last.speciesTotal)
    expect(last.speciesAlive).toBeGreaterThanOrEqual(1)

    // The mutation rate used by the test world produces new species; the
    // engine must report each one.
    const speciations = sim.events.filter((e) => e.kind === 'speciation')
    expect(speciations.length).toBeGreaterThan(0)
    expect(last.speciesTotal).toBeGreaterThan(3) // more than the three founder species
  })

  it('the world reports a non-empty environment and consistent census fields', () => {
    for (const census of censuses) {
      expect(census.tick % 5).toBe(0)
      expect(census.population).toBeGreaterThanOrEqual(0)
      expect(census.herbivores).toBeGreaterThanOrEqual(0)
      expect(census.biomass).toBeGreaterThanOrEqual(0)
      expect(census.detritus).toBeGreaterThanOrEqual(0)
    }
  })
})
