/**
 * Carrion availability, measured from under a founder carnivore's feet.
 * Companion to tests/scratch-meat-supply.ts; PROGRESS.md section 6D / section 8 step 3, candidate d.
 *
 * World.detritus is a litter pool with no consumer: carcasses are deposited on the tile where an
 * animal dies, and only decomposition and burial take energy back out of it. The candidate written for
 * that pool (a scavenging branch of behaveHunt that walks a carnivore to a litter pile and calls
 * World.takeDetritus) is measured and rejected in section 6D, and the engine no longer contains it.
 * Whether such a branch could ever pay is decided by a quantity that can be measured without it: an
 * animal can only eat where it stands. This probe wraps updateCreature and, for every founder
 * carnivore on every tick, records
 *
 *   - the litter on the tile it is standing on (an upper bound: the animal is never moved toward
 *     litter, and eating there would empty that tile);
 *   - the part of that litter it could have taken at that moment, min(litter, maxEnergy - energy);
 *   - the whole litter pool, so the litter held by the world can be compared with the share of it
 *     that happens to lie under carnivores' feet.
 *
 * Print-only diagnostic (not part of the vitest suite): 250-tick windows, 3000 ticks, seeds evolab
 * and evolab-2, on the default world (168x112) and on the 48x48 test configuration.
 *
 *   npx tsx tests/scratch-carrion.ts
 */

import { Simulation, type Creature } from '../src/sim/engine'
import { defaultConfig, type SimConfig } from '../src/sim/config'
import { testConfig } from './helpers'

const CARNIVORE_DIET = 0.7
const CHUNK_TICKS = 250
const TICKS = 3000
const SEEDS = ['evolab', 'evolab-2']

/** The engine method this probe observes. */
interface Observed {
  updateCreature(c: Creature): void
}

interface Tally {
  animalTicks: number
  standing: number
  usable: number
  peakTile: number
}

function num(v: number, dp: number): string {
  return Number.isFinite(v) ? v.toFixed(dp) : 'n/a'
}

function newTally(): Tally {
  return { animalTicks: 0, standing: 0, usable: 0, peakTile: 0 }
}

function addTally(total: Tally, window: Tally): void {
  total.animalTicks += window.animalTicks
  total.standing += window.standing
  total.usable += window.usable
  if (window.peakTile > total.peakTile) total.peakTile = window.peakTile
}

function founderIds(sim: Simulation): Set<number> {
  const ids = new Set<number>()
  for (const c of sim.creatures) {
    if (c.alive && c.phenotype.diet >= CARNIVORE_DIET) ids.add(c.id)
  }
  return ids
}

function countFounders(sim: Simulation, cohort: Set<number>): number {
  let alive = 0
  for (const c of sim.creatures) {
    if (c.alive && cohort.has(c.id)) alive += 1
  }
  return alive
}

function countBand(sim: Simulation): number {
  let band = 0
  for (const c of sim.creatures) {
    if (c.alive && c.phenotype.diet >= CARNIVORE_DIET) band += 1
  }
  return band
}

/** Reads the litter under each founder's feet, on the tick it is standing on it. */
function observe(sim: Simulation, cohort: Set<number>, tally: Tally): () => void {
  const proto = Object.getPrototypeOf(sim) as Observed
  const original = proto.updateCreature
  proto.updateCreature = function (this: Simulation, c: Creature): void {
    if (c.alive && cohort.has(c.id)) {
      const litter = this.world.detritus[this.world.index(Math.floor(c.x), Math.floor(c.y))]
      const room = Math.max(0, c.phenotype.maxEnergy - c.energy)
      tally.animalTicks += 1
      tally.standing += litter
      tally.usable += Math.min(litter, room)
      if (litter > tally.peakTile) tally.peakTile = litter
    }
    original.call(this, c)
  }
  return function restore(): void {
    proto.updateCreature = original
  }
}

function probe(label: string, config: SimConfig): void {
  const sim = new Simulation(config)
  const cohort = founderIds(sim)
  const total: Tally = newTally()

  console.log('')
  console.log(
    `=== ${label}  ${config.world.width}x${config.world.height}  seed=${config.world.seed}  ` +
      `founders tagged ${cohort.size}  ${CHUNK_TICKS}-tick windows to ${TICKS} ticks ===`
  )

  for (let tick = CHUNK_TICKS; tick <= TICKS; tick += CHUNK_TICKS) {
    const startFounders = countFounders(sim, cohort)
    const poolStart = sim.world.totalDetritus()
    const window: Tally = newTally()
    const restore = observe(sim, cohort, window)
    sim.run(CHUNK_TICKS)
    restore()

    const endFounders = countFounders(sim, cohort)
    const poolEnd = sim.world.totalDetritus()
    const band = countBand(sim)
    addTally(total, window)

    const animalTicks = Math.max(1, window.animalTicks)
    console.log(
      `  tick ${tick}  founders ${startFounders} -> ${endFounders}  carnivore band ${band}  ` +
        `litter pool ${num(poolStart, 1)} -> ${num(poolEnd, 1)} E`
    )
    console.log(
      `    ${window.animalTicks} animal-ticks  stood on ${num(window.standing, 2)} E ` +
      `(${num(window.standing / animalTicks, 4)} E per animal-tick)  ` +
      `could have taken ${num(window.usable, 4)} E  richest single tile ${num(window.peakTile, 2)} E`
    )
  }

  const animalTicks = Math.max(1, total.animalTicks)
  console.log(
    `  run totals: ${total.animalTicks} animal-ticks  stood on ${num(total.standing, 1)} E ` +
      `(${num(total.standing / animalTicks, 4)} E per animal-tick)  could have taken ` +
      `${num(total.usable, 2)} E  richest single tile ${num(total.peakTile, 2)} E  ` +
      `world litter pool at the end ${num(sim.world.totalDetritus(), 1)} E`
  )
}

for (const seed of SEEDS) {
  const config = defaultConfig()
  config.world.seed = seed
  probe('default world', config)
  probe('48x48 test configuration', testConfig(seed))
}
