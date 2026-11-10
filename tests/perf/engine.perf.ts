import { expect, it } from 'vitest'
import { Simulation } from '../../src/sim/engine'
import { defaultConfig } from '../../src/sim/config'
import { testConfig } from '../helpers'

/**
 * Engine benchmarks (milestone 6). Run with `npm run test:perf`.
 *
 * Named `*.perf.ts`, not `*.test.ts`: the default vitest include pattern only
 * matches `*.test.*`, so `npm run test` never runs these files.
 *
 * The interface runs the simulation at up to 10 ticks/s (SPEED_PRESETS in
 * src/store.ts), sharing every frame with rendering and panels. What that
 * actually requires of the engine is:
 *
 *   - well under 100 ms per tick at population ceiling (the 10 t/s budget);
 *   - a fresh world built in well under a second ("New world" must not freeze);
 *   - save/restore on the in-memory toState/fromState path (the state holds
 *     typed arrays and is not JSON-serialisable as-is).
 *
 * Limits are floors: set roughly an order of magnitude below the measurements
 * this file prints, so a failure means an algorithmic blow-up (quadratic
 * scans, per-tick allocations), not a noisy sample.
 */

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(values.length / 2)]
}

/** Median ms/tick over `chunks` timed runs of `ticksPerChunk` ticks each. */
function msPerTick(sim: Simulation, chunks: number, ticksPerChunk: number): number {
  const samples: number[] = []
  for (let i = 0; i < chunks; i++) {
    const start = performance.now()
    sim.run(ticksPerChunk)
    samples.push((performance.now() - start) / ticksPerChunk)
  }
  return median(samples)
}

it('sustains the top UI speed on a test world at population ceiling', () => {
  const sim = new Simulation(testConfig('perf-load'))
  sim.run(400) // a cold world is not the load case; grow to (near) the ceiling first
  expect(sim.creatures.length).toBeGreaterThan(100)

  const ms = msPerTick(sim, 3, 200)
  console.log(
    `[perf] warm 48x48 world, ${sim.creatures.length} creatures: ${ms.toFixed(3)} ms/tick ` +
      `(UI budget at 10 t/s: < 100 ms/tick shared with render + UI)`
  )
  // Measured 1.4–1.6 ms/tick at the 500-creature ceiling on this machine.
  expect(ms).toBeLessThan(50) // 30× headroom, and still half the real UI budget
})

it('the default 168x112 world at population ceiling stays inside the UI speed budget', () => {
  const start = performance.now()
  const sim = new Simulation(defaultConfig())
  const buildMs = performance.now() - start

  sim.run(1600) // grow toward the 3200 ceiling — that is the real load case
  expect(sim.creatures.length).toBeGreaterThan(2000)

  const ms = msPerTick(sim, 3, 100)
  console.log(
    `[perf] default 168x112 world built in ${buildMs.toFixed(1)} ms; ` +
      `warm population ${sim.creatures.length}: ${ms.toFixed(3)} ms/tick`
  )
  // Measured on this machine: build ~20 ms, ~14–16 ms/tick at ~3200 creatures.
  // 100 ms is not invented headroom — it is what 10 ticks/s leaves per frame.
  expect(buildMs).toBeLessThan(1000)
  expect(ms).toBeLessThan(100)
})

it('saves and restores a loaded test world in well under a second', () => {
  // The same warm fixture as the load test: a near-ceiling world is the
  // heaviest state the save/restore path can carry. (Some seeds collapse to a
  // small population; this one deterministically grows to ~500.)
  const sim = new Simulation(testConfig('perf-load'))
  sim.run(400)
  expect(sim.creatures.length).toBeGreaterThan(100)

  const start = performance.now()
  const state = sim.toState()
  const restored = Simulation.fromState(state)
  const ms = performance.now() - start

  console.log(
    `[perf] save/restore: ${sim.creatures.length} creatures + 48x48 world in ${ms.toFixed(1)} ms`
  )
  expect(sim.creatures.length).toBe(restored.creatures.length)
  expect(ms).toBeLessThan(1000)
})
