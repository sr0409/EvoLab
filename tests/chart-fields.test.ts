import { describe, expect, it } from 'vitest'
import { CHART_FIELDS, Simulation } from '../src/sim/engine'
import {
  CENSUS_FIELDS,
  CENSUS_FIELD_LABELS,
  type CensusField,
  type CensusRecord
} from '../src/sim/stats'
import { testConfig } from './helpers'

/**
 * Chartable census fields: the diet and death series the charts panel is allowed
 * to offer.
 *
 * The charts can only show a metric the engine buffers, so the diet-melt
 * question — does a diet class die out, or do its animals simply stop being
 * that diet? — depends on the diet and death series being chartable. These
 * tests pin the contract between what the engine measures, what it samples,
 * and what the UI is allowed to offer.
 */

const CENSUS_PERIOD = 5
const RUN_TICKS = 200

function runWithCensuses(seed: string): { sim: Simulation; censuses: CensusRecord[] } {
  const sim = new Simulation(testConfig(seed))
  const censuses: CensusRecord[] = [{ ...sim.lastCensus! }] // the tick-0 census
  for (let done = CENSUS_PERIOD; done <= RUN_TICKS; done += CENSUS_PERIOD) {
    sim.run(CENSUS_PERIOD)
    const census = sim.lastCensus
    if (!census || census.tick !== done) throw new Error(`missing census at tick ${done}`)
    censuses.push({ ...census })
  }
  return { sim, censuses }
}

describe('chartable census fields', () => {
  it('every chartable field is a measured census field with a label', () => {
    for (const field of CHART_FIELDS) {
      expect(CENSUS_FIELDS).toContain(field)
      expect(typeof CENSUS_FIELD_LABELS[field]).toBe('string')
      expect(CENSUS_FIELD_LABELS[field].length).toBeGreaterThan(0)
    }
  })

  it('the diet and death series that answer the diet-melt question are chartable', () => {
    // Without these the app cannot tell starvation (the carnivores die) apart
    // from absorption (the diet gene drifts down and they survive as omnivores).
    const required: CensusField[] = [
      'population',
      'herbivores',
      'omnivores',
      'carnivores',
      'meanDiet',
      'births',
      'deaths',
      'meanEnergyRatio'
    ]
    for (const field of required) expect(CHART_FIELDS).toContain(field)
  })

  it('every chartable field has a series that reproduces its census values', () => {
    const { sim, censuses } = runWithCensuses('chart-series')

    for (const field of CHART_FIELDS) {
      const samples = sim.seriesSamples(field, 1000)
      expect(samples.values.length).toBe(censuses.length)
      expect(samples.ticks[0]).toBe(0)
      expect(samples.ticks[samples.ticks.length - 1]).toBe(RUN_TICKS)

      // Buffered samples are oldest-first on census ticks, so sample i belongs
      // to censuses[i]; compare each against the census that produced it.
      for (let i = 0; i < censuses.length; i++) {
        expect(samples.ticks[i]).toBe(censuses[i].tick)
        expect(samples.values[i]).toBe(censuses[i][field])
      }

      // The legend reads seriesLatest(), so it must agree with the last census.
      const last = censuses[censuses.length - 1]
      expect(sim.seriesLatest(field)).toBe(last[field])
    }
  })
})
