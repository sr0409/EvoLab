# EvoLab

A browser-based artificial evolution and ecosystem simulation: a small world of
plants and animals runs under energy budgets, predation, thermal stress, and
inheritance, and population trajectories are measured over long runs.

See [PROGRESS.md](PROGRESS.md) for the research log — what has been measured,
what candidates were tried, and what the current binding constraint is.

## Requirements

- Node.js 18+ and npm (Vite 6 requirement)
- No runtime dependencies beyond Vue; everything is installed with npm.

## Install

```sh
npm install
```

## Run the simulation in the browser

```sh
npm run dev        # Vite dev server (prints a localhost URL)
```

Or a production build:

```sh
npm run build      # type-checks, then builds to dist/
npm run preview    # serves the built app
```

## Tests and checks

```sh
npm run typecheck  # vue-tsc, no emit
npm run test       # vitest unit tests
npm run test:watch # vitest watch mode
npm run test:perf  # vitest performance suite
npm run test:e2e   # Playwright end-to-end tests (needs `npx playwright install` once)
npm run test:all   # unit + perf + e2e
```

## Diagnostic probes

The `tests/scratch-*.ts` files are diagnostic probes (run logs, not test
suites). They are run with vite-node, e.g.:

```sh
npx vite-node tests/scratch-carrion-walk.ts
```

Each probe is listed with its purpose in §7 of [PROGRESS.md](PROGRESS.md).
They run several 3000-tick simulations, so a few minutes per probe is normal.
