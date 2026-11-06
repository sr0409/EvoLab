import { describe, it } from 'vitest'
import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { BEHAVIOR_COUNT, BEHAVIOR_NAMES, DEATH_CAUSES } from '../src/sim/types'
import type { DeathCause } from '../src/sim/types'
import type { Creature } from '../src/sim/engine'

/**
 * Diagnostic probe for the open question in PROGRESS.md §6: why strict meat-eaters do not hold
 * energy. It measures and prints; it changes no engine rule. The permanent assertions this evidence
 * supports belong in tests/ecology.test.ts. Run on its own with:
 *
 *   npx vitest run tests/scratch.test.ts
 *
 * What makes the numbers trustworthy:
 *
 *   The band, not the population. Every animal whose phenotype diet is >= 0.7 — the band
 *   `behaveHunt` gives no plant fallback to (engine.ts 739) — joins the tracked set as soon as it
 *   is alive, and is followed by id. Averaging the whole population would let this band starve away
 *   unnoticed.
 *
 *   Cost is read from the accounts, not guessed from traits. Energy enters an animal in exactly two
 *   places (`attack`, `behaveForage`) and leaves in exactly three: the tick bill (engine.ts 553-566),
 *   the share handed to offspring (`breed`), and whatever the body still holds when it dies. So for
 *   one animal over one tick
 *
 *     burnt = energyIn + meat + plant - offspring - carrion - energyOut
 *
 *   is what the engine actually charged it.
 *
 *   Rates are per animal-tick actually lived. An animal that died on tick 40 is not charged over 200
 *   ticks: every per-tick figure below divides by the ticks the animal was actually updated for, so a
 *   short life cannot be mistaken for a cheap one.
 *
 *   Availability is classified with the engine's own hunting gates (`prey.mass < hunter.mass *
 *   (0.35 + 1.7 * diet)` and `prey.energy > 0.2`, engine.ts 721-729) at two distances: within
 *   `senseRadius`, which is all `behaveHunt` can aim at, and beyond it. That separates "no such prey
 *   exists" from "prey exists but is out of sight" from "prey is too thin to chase".
 */

const STRICT_DIET = 0.7
const WINDOW_TICKS = 400
const WINDOWS = 2
/** Prey access costs a full population pass per animal, so it is sampled rather than total. */
const SAMPLED_PER_CHECKPOINT = 8
const CHECKPOINTS_PER_WINDOW = 4
/** How far a prey observation looks; anything outside this is not "missed", it is unseen. */
const NEIGHBOURHOOD_TILES = 12

interface Tracked {
  id: number
  diet: number
  alive: boolean
  /** Window accounts, reset each window. */
  meat: number
  plant: number
  offspring: number
  burnt: number
  carrion: number
  attacks: number
  kills: number
  births: number
  ticksLived: number
  behaviours: number[]
  deaths: Partial<Record<DeathCause, number>>
  startEnergy: number
  endEnergy: number
  peakEnergy: number
  maxEnergy: number
  mass: number
  senseRadius: number
  basalRate: number
  moveCostCoefficient: number
}

interface PreyObservation {
  observations: number
  animalsThatCouldSeePrey: number
  preyInSight: number
  preyNearButOutOfSight: number
  rejectedTooBig: number
  rejectedTooThin: number
  smallerThanTheCapAnywhere: number
  senseRadiusSum: number
  massCapSum: number
  nearestEligibleDistance: number
  nearestEligibleEnergy: number
  nearestEligibleMass: number
}

const emptyPreyObservation = (): PreyObservation => ({
  observations: 0,
  animalsThatCouldSeePrey: 0,
  preyInSight: 0,
  preyNearButOutOfSight: 0,
  rejectedTooBig: 0,
  rejectedTooThin: 0,
  smallerThanTheCapAnywhere: 0,
  senseRadiusSum: 0,
  massCapSum: 0,
  nearestEligibleDistance: Number.POSITIVE_INFINITY,
  nearestEligibleEnergy: 0,
  nearestEligibleMass: 0,
})

/** The engine's private methods, seen from outside the class. */
interface InternalMethods {
  attack(c: Creature, prey: Creature): void
  behaveForage(c: Creature): number
  breed(a: Creature, b: Creature): void
  updateCreature(c: Creature): void
  kill(c: Creature, cause: DeathCause): void
}

function newTracked(c: Creature): Tracked {
  return {
    id: c.id,
    diet: c.phenotype.diet,
    alive: true,
    meat: 0,
    plant: 0,
    offspring: 0,
    burnt: 0,
    carrion: 0,
    attacks: 0,
    kills: 0,
    births: 0,
    ticksLived: 0,
    behaviours: new Array<number>(BEHAVIOR_COUNT).fill(0),
    deaths: {},
    startEnergy: c.energy,
    endEnergy: c.energy,
    peakEnergy: c.energy,
    maxEnergy: c.phenotype.maxEnergy,
    mass: c.phenotype.mass,
    senseRadius: c.phenotype.senseRadius,
    basalRate: c.phenotype.basalRate,
    moveCostCoefficient: c.phenotype.moveCostCoefficient,
  }
}

/**
 * Attributes every energy change of a tracked animal to that animal, so its tick bill can be derived
 * from the accounts. Returns the function that puts the engine back as it was.
 */
function instrument(sim: Simulation, band: Map<number, Tracked>): () => void {
  const proto = Object.getPrototypeOf(sim) as InternalMethods
  const original = {
    attack: proto.attack,
    behaveForage: proto.behaveForage,
    breed: proto.breed,
    updateCreature: proto.updateCreature,
    kill: proto.kill,
  }

  proto.attack = (c: Creature, prey: Creature): void => {
    const tracked = band.get(c.id)
    if (!tracked) return original.attack.call(sim, c, prey)
    tracked.attacks += 1
    const before = c.energy
    original.attack.call(sim, c, prey)
    if (c.energy > before) {
      tracked.kills += 1
      tracked.meat += c.energy - before
    }
  }

  proto.behaveForage = (c: Creature): number => {
    const tracked = band.get(c.id)
    if (!tracked) return original.behaveForage.call(sim, c)
    const before = c.energy
    const moved = original.behaveForage.call(sim, c)
    tracked.plant += c.energy - before
    return moved
  }

  proto.breed = (a: Creature, b: Creature): void => {
    const fromA = band.get(a.id)
    const fromB = band.get(b.id)
    if (!fromA && !fromB) return original.breed.call(sim, a, b)
    const beforeA = a.energy
    const beforeB = b.energy
    original.breed.call(sim, a, b)
    if (fromA) {
      fromA.offspring += beforeA - a.energy
      fromA.births += 1
    }
    if (fromB) {
      fromB.offspring += beforeB - b.energy
      fromB.births += 1
    }
  }

  // What a body still holds when it dies left as carrion, not as heat. Separating the two is what
  // makes `burnt` equal to the charge instead of an upper bound for it.
  proto.kill = (c: Creature, cause: DeathCause): void => {
    const tracked = band.get(c.id)
    if (tracked) {
      tracked.carrion += c.energy
      tracked.deaths[cause] = (tracked.deaths[cause] ?? 0) + 1
      tracked.alive = false
      tracked.endEnergy = 0
    }
    original.kill.call(sim, c, cause)
  }

  proto.updateCreature = (c: Creature): void => {
    const tracked = band.get(c.id)
    if (!tracked) return original.updateCreature.call(sim, c)
    const energyIn = c.energy
    const meatIn = tracked.meat
    const plantIn = tracked.plant
    const offspringIn = tracked.offspring
    const carrionIn = tracked.carrion
    original.updateCreature.call(sim, c)
    tracked.burnt +=
      energyIn +
      (tracked.meat - meatIn) +
      (tracked.plant - plantIn) -
      (tracked.offspring - offspringIn) -
      (tracked.carrion - carrionIn) -
      c.energy
    tracked.ticksLived += 1
    tracked.behaviours[c.behavior] += 1
    if (c.alive) {
      tracked.endEnergy = c.energy
      if (c.energy > tracked.peakEnergy) tracked.peakEnergy = c.energy
    }
  }

  return () => {
    proto.attack = original.attack
    proto.behaveForage = original.behaveForage
    proto.breed = original.breed
    proto.updateCreature = original.updateCreature
    proto.kill = original.kill
  }
}

/**
 * Registers any band member that is alive and not yet tracked, and returns those alive at the start
 * of the window. `joined` counts newcomers, so a band being replaced one animal at a time cannot read
 * as a stable one.
 */
function syncBand(sim: Simulation, band: Map<number, Tracked>): { members: Tracked[]; joined: number } {
  let joined = 0
  for (const c of sim.creatures) {
    if (!c.alive || c.phenotype.diet < STRICT_DIET) continue
    let tracked = band.get(c.id)
    if (!tracked) {
      tracked = newTracked(c)
      band.set(c.id, tracked)
      joined += 1
    }
    tracked.alive = true
    tracked.startEnergy = c.energy
    tracked.endEnergy = c.energy
  }
  const members: Tracked[] = []
  for (const tracked of band.values()) if (tracked.alive) members.push(tracked)
  return { members, joined }
}

/**
 * One animal's view of what it is allowed to eat, using the engine's own gates. The search is widened
 * past `senseRadius` so that unseen prey appears as "out of sight" instead of vanishing from the
 * figures.
 */
function observePrey(sim: Simulation, hunter: Creature, out: PreyObservation): void {
  const ph = hunter.phenotype
  const massCap = ph.mass * (0.35 + 1.7 * ph.diet)
  out.observations += 1
  out.senseRadiusSum += ph.senseRadius
  out.massCapSum += massCap

  let inSight = 0
  let outOfSight = 0
  for (const other of sim.creatures) {
    if (!other.alive || other.id === hunter.id || other.speciesId === hunter.speciesId) continue
    if (other.phenotype.mass >= massCap) {
      if (Math.hypot(other.x - hunter.x, other.y - hunter.y) <= NEIGHBOURHOOD_TILES) out.rejectedTooBig += 1
      continue
    }
    if (other.energy <= 0.2) {
      if (Math.hypot(other.x - hunter.x, other.y - hunter.y) <= NEIGHBOURHOOD_TILES) out.rejectedTooThin += 1
      continue
    }
    const distance = Math.hypot(other.x - hunter.x, other.y - hunter.y)
    out.smallerThanTheCapAnywhere += 1
    if (distance < out.nearestEligibleDistance) {
      out.nearestEligibleDistance = distance
      out.nearestEligibleEnergy = other.energy
      out.nearestEligibleMass = other.phenotype.mass
    }
    if (distance > NEIGHBOURHOOD_TILES) continue
    if (distance <= ph.senseRadius) inSight += 1
    else outOfSight += 1
  }
  out.preyInSight += inSight
  out.preyNearButOutOfSight += outOfSight
  if (inSight > 0) out.animalsThatCouldSeePrey += 1
}

function sampleBand(sim: Simulation, members: Tracked[], out: PreyObservation): void {
  const alive: Creature[] = []
  for (const tracked of members) {
    if (!tracked.alive) continue
    const c = sim.findCreature(tracked.id)
    if (c && c.alive) alive.push(c)
  }
  const stride = Math.max(1, Math.ceil(alive.length / SAMPLED_PER_CHECKPOINT))
  for (let i = 0; i < alive.length; i += stride) observePrey(sim, alive[i], out)
}

const mean = (values: number[]): number => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0)
const num = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a')

/** Rates are per animal-tick actually lived, so an animal that died early is not spread thin. */
function perLivedTick(tracked: Tracked, value: number): number {
  return tracked.ticksLived > 0 ? value / tracked.ticksLived : 0
}

function reportWindow(sim: Simulation, windowIndex: number, members: Tracked[], joined: number, prey: PreyObservation): void {
  const survivors = members.filter((tracked) => sim.findCreature(tracked.id)?.alive)
  const lived = members.map((m) => m.ticksLived)
  const rate = (pick: (m: Tracked) => number): number => mean(members.map((m) => perLivedTick(m, pick(m))))

  const meat = rate((m) => m.meat)
  const burnt = rate((m) => m.burnt)
  const kills = rate((m) => m.kills)
  const attacks = rate((m) => m.attacks)
  const energyPerKill = kills > 0 ? meat / kills : Number.NaN
  const ticksWorthOneKill = burnt > 0 && Number.isFinite(energyPerKill) ? energyPerKill / burnt : Number.NaN

  const behaviourTotals = new Array<number>(BEHAVIOR_COUNT).fill(0)
  for (const m of members) for (let i = 0; i < BEHAVIOR_COUNT; i++) behaviourTotals[i] += m.behaviours[i]
  const behaviourTicks = behaviourTotals.reduce((s, v) => s + v, 0) || 1

  const deaths: Partial<Record<DeathCause, number>> = {}
  for (const m of members) for (const cause of DEATH_CAUSES) if (m.deaths[cause]) deaths[cause] = (deaths[cause] ?? 0) + m.deaths[cause]

  const audit = sim.auditEnergy()
  const observations = Math.max(1, prey.observations)
  const bandSizeAtEnd = survivors.length

  console.log(
    [
      `window ${windowIndex}  band at start ${members.length} (newly joined ${joined})  band at end ${bandSizeAtEnd}` +
        `  ticks lived per animal ${num(mean(lived), 0)} (window is ${WINDOW_TICKS} ticks)`,
      `  per animal per tick lived   meat ${num(meat, 4)}  plant ${num(rate((m) => m.plant), 4)}` +
        `  burnt ${num(burnt, 4)}  to offspring ${num(rate((m) => m.offspring), 4)}  carrion ${num(rate((m) => m.carrion), 4)}`,
      `  net balance ${num(meat + rate((m) => m.plant) - burnt - rate((m) => m.offspring), 4)} per tick` +
        `  energy ${num(mean(members.map((m) => m.startEnergy)), 2)} -> ${num(mean(members.map((m) => m.endEnergy)), 2)}` +
        `  peak ${num(mean(members.map((m) => m.peakEnergy)), 2)}  capacity ${num(mean(members.map((m) => m.maxEnergy)), 2)}`,
      `  hunting   attacks ${num(attacks, 4)}/tick  kills ${num(kills, 4)}/tick` +
        `  animals that never attacked ${members.filter((m) => m.attacks === 0).length}/${members.length}` +
        `  animals that never ate ${members.filter((m) => m.meat === 0).length}/${members.length}`,
      `  one kill is worth ${num(energyPerKill, 2)} energy = ${num(ticksWorthOneKill, 1)} ticks of this animal's own cost`,
      `  how its time was spent   ${BEHAVIOR_NAMES.map(
        (name, i) => `${name} ${((behaviourTotals[i] / behaviourTicks) * 100).toFixed(1)}%`
      ).join('  ')}`,
      `  the terms that set the bill   basalRate ${num(mean(members.map((m) => m.basalRate)), 4)}` +
        `  moveCostCoefficient ${num(mean(members.map((m) => m.moveCostCoefficient)), 4)}` +
        `  mass ${num(mean(members.map((m) => m.mass)), 2)}  diet ${num(mean(members.map((m) => m.diet)), 2)}` +
        `  (names the terms only; burnt above is measured)`,
      `  prey access, ${prey.observations} observations over ${CHECKPOINTS_PER_WINDOW} checkpoints` +
        `  animals that could see something they were allowed to eat ${prey.animalsThatCouldSeePrey}/${prey.observations}`,
      `    allowed prey within their sense radius (avg sense radius ${num(prey.senseRadiusSum / observations, 2)})` +
        `  ${prey.preyInSight}   allowed prey nearby but out of sight  ${prey.preyNearButOutOfSight}`,
      `    rejected nearby: too big to be prey ${prey.rejectedTooBig}   present but too thin to chase ${prey.rejectedTooThin}` +
        `  mass cap ${num(prey.massCapSum / observations, 3)}`,
      `    nearest allowed prey anywhere in the world  ${num(prey.nearestEligibleDistance, 1)} tiles` +
        `  (energy ${num(prey.nearestEligibleEnergy, 2)}  mass ${num(prey.nearestEligibleMass, 3)})`,
      `  deaths in this band   ${DEATH_CAUSES.map((c) => `${c} ${deaths[c] ?? 0}`).join('  ')}`,
      `  world   band diet >= ${STRICT_DIET} alive now ${bandSizeAtEnd}` +
        `  total population ${sim.creatures.filter((c) => c.alive).length}` +
        `  audit delta ${audit.delta.toExponential(2)}  biomass ${num(audit.biomass, 1)}  litter ${num(audit.detritus, 1)}` +
        `  animal energy ${num(audit.creatures, 1)}`,
    ].join('\n')
  )
}

describe('probe: the top of the food web', () => {
  it('follows the strict meat-eater band through what it gains, burns and can reach', () => {
    const sim = new Simulation(defaultConfig())
    const band = new Map<number, Tracked>()
    const restore = instrument(sim, band)

    try {
      for (let windowIndex = 1; windowIndex <= WINDOWS; windowIndex += 1) {
        const { members, joined } = syncBand(sim, band)
        if (members.length === 0) {
          console.log(`window ${windowIndex}: nothing alive has diet >= ${STRICT_DIET}; the band is gone`)
          break
        }
        for (const tracked of members) {
          tracked.meat = 0
          tracked.plant = 0
          tracked.offspring = 0
          tracked.burnt = 0
          tracked.carrion = 0
          tracked.attacks = 0
          tracked.kills = 0
          tracked.births = 0
          tracked.ticksLived = 0
          tracked.behaviours.fill(0)
          tracked.deaths = {}
          tracked.peakEnergy = tracked.startEnergy
        }

        const prey = emptyPreyObservation()
        const checkpointEvery = Math.max(1, Math.floor(WINDOW_TICKS / CHECKPOINTS_PER_WINDOW))
        for (let tick = 0; tick < WINDOW_TICKS; tick += checkpointEvery) {
          sampleBand(sim, members, prey)
          sim.run(Math.min(checkpointEvery, WINDOW_TICKS - tick))
        }
        reportWindow(sim, windowIndex, members, joined, prey)
      }
    } finally {
      restore()
    }
  })
})
