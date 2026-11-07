import { defineConfig } from 'vitest/config'

/**
 * Performance suite (milestone 6). Run with `npm run test:perf`.
 *
 * Separate config so `npm run test` stays fast: these files time real work
 * over hundreds of ticks and are not meant to run on every save.
 * Thresholds are machine-dependent by nature; they are set far below measured
 * performance (measured values are recorded in PROGRESS.md §10) so they catch
 * large regressions rather than noisy jitter.
 */
export default defineConfig({
  test: {
    // `*.perf.ts`, not `*.test.ts`: the default `npm run test` include pattern
    // never matches these files, so the fast suite stays untouched.
    include: ['tests/perf/**/*.perf.ts'],
    testTimeout: 120_000
  }
})
