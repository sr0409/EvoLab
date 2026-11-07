import { devices, defineConfig } from '@playwright/test'

/**
 * End-to-end tests (milestone 6). Run with `npm run test:e2e`.
 *
 * They drive the real interface against the real dev server: the spec reads
 * the tick/seed/population readout in the control bar, so a failure here
 * means the built app is broken somewhere across the sim → store → UI
 * boundary, not just one module.
 */
export default defineConfig({
  testDir: './e2e',
  // `*.e2e.ts` instead of the default `*.spec.ts`: vitest's default include
  // pattern matches `*.test.*` and `*.spec.*`, so this keeps `npm run test`
  // free of browser tests without adding vitest exclusions to the shared config.
  testMatch: '**/*.e2e.ts',
  // Single worker: the tests share the one dev server and the app's own
  // simulation state; serial runs keep them independent of timing.
  workers: 1,
  fullyParallel: false,
  timeout: 30_000,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4173',
    headless: true
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev -- --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000
  }
})
