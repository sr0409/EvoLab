# EvoLab

**An artificial evolution sandbox that runs in your browser.** EvoLab simulates a small
world — terrain, climate, plants, and animals with individual genes — and lets you watch
it live: populations grow and crash, animals hunt or graze, newborns inherit a mix of
their parents' traits, and new species emerge over thousands of generations.

There is no goal and no score. You set up a world, press play, and investigate what
happens with charts, a species roster, and live statistics.

## Getting started

You need [Node.js](https://nodejs.org/) 18 or newer.

```sh
npm install
npm run dev
```

Open the URL the dev server prints (usually `http://localhost:5173`). A world is
generated and already running when the page loads.

To build and serve the production version instead:

```sh
npm run build
npm run preview
```

## The interface

- **World map** (top left) — the living world. Switch the view between **Terrain**,
  **Biomass** (how productive each area is), and **Temperature**. Each dot is an animal,
  colored by its diet: plant-eaters, omnivores, and meat-eaters are distinct colors.
- **Run controls** (top bar) — pause, single-step, and simulation speed.
- **Charts panel** — plot any measured series over time: population, temperature,
  biomass, the diet classes, the population's mean diet gene, births, deaths, and more.
  You can overlay up to three series at once and switch between shared and independent
  axis scaling — overlaying, say, *Mean diet gene* with *Carnivores* is the quickest way
  to see what a trend actually means.
- **Stats panel** — live totals: population, energy, biomass, litter.
- **Species roster** — every lineage that has emerged, with population, body size, diet,
  and how often each went extinct and was replaced.
- **Event log** — births of new species, extinctions, and other notable moments.

## Scenarios

The **Scenario** dropdown applies a curated world setup in one click:

| Scenario | What it does |
|---|---|
| Temperate baseline | The default stable world |
| Greenhouse shift | A warming climate (+6 °C and still rising) — tests thermal adaptation |
| Ice age | Cold, harsh, strongly seasonal |
| Monsoon pulses | Rain arrives in one violent season: boom-and-bust food supply |
| Famine | A thin, unproductive biosphere |
| Mutagenic radiation | Heavy mutation load: rapid divergence and many new lineages |

## Knobs you can twist mid-run

All take effect on the running world immediately:

- **Seed** + **New world** — the same seed always generates the exact same world, so an
  experiment you ran once you can rerun and share.
- **Population cap** — the hard ceiling on living creatures.
- **Prey energy floor** — how well-fed an animal must be to be huntable as quarry.
- **Meat assimilation** — how much of a kill a predator's gut can absorb.
- **Juvenile plant allowance** — whether strict carnivores' young may graze before maturity.

## What's actually simulated

Every animal is an individual with its own genome: diet, body size, metabolism, speed,
thermal tolerance, gut efficiency, and more. Each tick the engine applies the same rules
to all of them:

- **Energy is real and audited.** Animals pay for metabolism, movement, and staying warm
  out of a personal energy budget, and every joule in the world is tracked — from
  photosynthesis to heat to litter. Nothing appears from nowhere.
- **Eating is a trade.** A carnivore gets a lot from a kill but must catch it; a grazer
  has food everywhere but a lower-energy diet. Diet is genetic, not chosen.
- **Death comes from many causes.** Starvation, predation, disease, thermal stress, old
  age — the stats panel tallies them.
- **Evolution happens at birth.** Newborns inherit a mix of both parents' genes with
  mutations. When a lineage drifts far enough from its ancestors, the engine registers it
  as a new species.

A recurring finding in this world: **strict carnivores have a hard time**. A meat-based
diet is expensive to sustain, and carnivore lineages tend to die out within a generation
or two unless conditions are unusually favorable. The chart panel's diet series let you
watch exactly how and when that happens.

## For developers

```sh
npm run test        # vitest unit tests
npm run test:perf   # performance benchmarks
npm run test:e2e    # Playwright end-to-end tests (run `npx playwright install` once first)
npm run test:all    # everything
npm run typecheck   # vue-tsc, no emit
```

The `tests/scratch-*.ts` files are diagnostic probes (measurement runs, not part of the
test suite), run with `npx vite-node tests/scratch-<name>.ts`.

[PROGRESS.md](PROGRESS.md) is the project's engineering and research log: what has been
built, what has been measured, and what is still open. It explains the simulation's
design decisions in detail.
