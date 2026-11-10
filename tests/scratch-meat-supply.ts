/**
 * Candidate (d) measurement: the meat supply a strict carnivore can actually draw on.
 *
 * The founder band starves with plant intake exactly zero, so its whole energy supply is the meat
 * channel. This probe prices that channel from the animal's own side of the ledger, window by window:
 *
 *   supply  what the animal is allowed to eat at this moment, judged by the engine's own
 *           `preyIsLegal` (engine.ts 780): how many animals inside its own `senseRadius` pass all
 *           three gates, how much energy those bodies hold, how much legal-quarry energy exists in
 *           the whole world for a phenotype like its own, and how far away the nearest one is.
 *           Animals that fail a gate are counted against the gate that stopped them.
 *   gate    how much of that legal supply the engine's own chase rule (`pursuitIsWorthwhile`,
 *           engine.ts 852) will commit to. Asked of the engine itself for every legal animal in
 *           sight; the refused ones are reported with the two quantities the rule weighs — the payoff
 *           a bite would pay and the hunting-tick cost of closing the gap — so the refusals can be
 *           read as prices rather than as a black box.
 *   chain   what the animal does with what it may chase: hunt ticks, quarry committed to, strikes,
 *           kills, the energy its strikes took out of prey bodies, and the energy it absorbed.
 *   bill    what the animal spends, taken from the engine's own energy accounts by the same identity
 *           `tests/scratch.test.ts` uses (inflow + what left the body - what remains), never from its
 *           trait values.
 *
 * The probe changes no engine rule and asserts nothing; it prices the exchange candidate (d) is about.
 *
 *   npx vite-node tests/scratch-meat-supply.ts
 */

import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { BEHAVIOR_HUNT, DEATH_CAUSES } from '../src/sim/types'
import type { DeathCause } from '../src/sim/types'

const SEEDS = ['evolab', 'evolab-2']
const WINDOW_TICKS = 250
const WINDOWS = 4
const STRICT_DIET = 0.7
/** A supply scan is a whole-population pass per animal, so animals and checkpoints are sampled. */
const SAMPLED_ANIMALS = 3
const CHECKPOINTS = 2

/** The engine's own predation path, reached through the instance so nothing is re-implemented. */
interface EnginePath {
  attack(c: Creature, prey: Creature): void
  behaveForage(c: Creature): number
  breed(a: Creature, b: Creature): void
  kill(c: Creature, cause: DeathCause): void
  updateCreature(c: Creature): void
  pickQuarry(c: Creature): Creature | undefined
  preyIsLegal(c: Creature, other: Creature): boolean
  pursuitIsWorthwhile(c: Creature, quarry: Creature): boolean
}

interface FounderRec {
  id: number
  /** The creature object itself, kept so a scan still works after the animal dies. */
  self: Creature
  diet: number
  digest: number
  mass: number
  speed: number
  aggression: number
  senseRadius: number
  maxEnergy: number
  basalRate: number
  moveCostCoefficient: number
  // window accounting, reset at each window boundary
  startEnergy: number
  endEnergy: number
  peakEnergy: number
  ticksLived: number
  meat: number
  plant: number
  offspring: number
  carrion: number
  burnt: number
  attacks: number
  strikesMissed: number
  kills: number
  preyBodyEnergy: number
  quarryChosen: number
  huntTicks: number
  deaths: Partial<Record<DeathCause, number>>
}

interface SupplyReading {
  scans: number
  /** Legal prey inside the animal's own sense radius, and the energy those bodies hold. */
  legalInSight: number
  legalEnergyInSight: number
  /** Of those, how many the engine's own chase rule will commit to, and their energy. */
  chasable: number
  chasableEnergy: number
  refused: number
  refusedEnergy: number
  /** The best bite the engine would take, and the best bite it would turn down. */
  bestAcceptedPayoff: number
  bestAcceptedTiles: number
  bestRefusedPayoff: number
  bestRefusedTiles: number
  bestRefusedCost: number
  nearestLegalTiles: number
  nearestLegalEnergy: number
  legalInWorld: number
  legalEnergyInWorld: number
  rejectSameSpecies: number
  rejectTooYoung: number
  rejectTooBig: number
  rejectTooThin: number
  senseRadiusSum: number
  massCapSum: number
  strikeRangeSum: number
  huntTickCostSum: number
}

const num = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a')
const mean = (values: number[]): number => (values.length ? values.reduce((s, v) => s + v, 0) / values.length : 0)
/** Rates are per animal-tick actually lived, so a short life is not read as a cheap one. */
const perLived = (total: number, ticks: number): number => (ticks > 0 ? total / ticks : 0)

function newFounder(c: Creature): FounderRec {
  const ph = c.phenotype
  return {
    id: c.id,
    self: c,
    diet: ph.diet,
    digest: ph.digest,
    mass: ph.mass,
    speed: ph.speed,
    aggression: ph.aggression,
    senseRadius: ph.senseRadius,
    maxEnergy: ph.maxEnergy,
    basalRate: ph.basalRate,
    moveCostCoefficient: ph.moveCostCoefficient,
    startEnergy: c.energy,
    endEnergy: c.energy,
    peakEnergy: c.energy,
    ticksLived: 0,
    meat: 0,
    plant: 0,
    offspring: 0,
    carrion: 0,
    burnt: 0,
    attacks: 0,
    strikesMissed: 0,
    kills: 0,
    preyBodyEnergy: 0,
    quarryChosen: 0,
    huntTicks: 0,
    deaths: {},
  }
}

function newSupplyReading(): SupplyReading {
  return {
    scans: 0,
    legalInSight: 0,
    legalEnergyInSight: 0,
    chasable: 0,
    chasableEnergy: 0,
    refused: 0,
    refusedEnergy: 0,
    bestAcceptedPayoff: 0,
    bestAcceptedTiles: Number.POSITIVE_INFINITY,
    bestRefusedPayoff: 0,
    bestRefusedTiles: 0,
    bestRefusedCost: 0,
    nearestLegalTiles: Number.POSITIVE_INFINITY,
    nearestLegalEnergy: 0,
    legalInWorld: 0,
    legalEnergyInWorld: 0,
    rejectSameSpecies: 0,
    rejectTooYoung: 0,
    rejectTooBig: 0,
    rejectTooThin: 0,
    senseRadiusSum: 0,
    massCapSum: 0,
    strikeRangeSum: 0,
    huntTickCostSum: 0,
  }
}

/**
 * Attributes every energy change of a tracked animal to it, so the bill can be derived from the
 * accounts, and counts what the engine's own predation path actually commits to.
 */
function instrument(sim: Simulation, cohort: Map<number, FounderRec>): () => void {
  const path = Object.getPrototypeOf(sim) as EnginePath
  const original = {
    attack: path.attack,
    behaveForage: path.behaveForage,
    breed: path.breed,
    kill: path.kill,
    updateCreature: path.updateCreature,
    pickQuarry: path.pickQuarry,
  }

  path.attack = (c: Creature, prey: Creature): void => {
    const rec = cohort.get(c.id)
    if (!rec) {
      original.attack.call(sim, c, prey)
      return
    }
    const bodyEnergy = prey.energy
    const before = c.energy
    original.attack.call(sim, c, prey)
    const absorbed = c.energy - before
    rec.attacks += 1
    if (absorbed > 0) {
      rec.kills += 1
      rec.meat += absorbed
      rec.preyBodyEnergy += bodyEnergy
    } else {
      rec.strikesMissed += 1
    }
  }

  path.behaveForage = (c: Creature): number => {
    const rec = cohort.get(c.id)
    if (!rec) return original.behaveForage.call(sim, c)
    const before = c.energy
    const moved = original.behaveForage.call(sim, c)
    rec.plant += c.energy - before
    return moved
  }

  path.breed = (a: Creature, b: Creature): void => {
    const fromA = cohort.get(a.id)
    const fromB = cohort.get(b.id)
    if (!fromA && !fromB) {
      original.breed.call(sim, a, b)
      return
    }
    const energyA = a.energy
    const energyB = b.energy
    original.breed.call(sim, a, b)
    if (fromA) fromA.offspring += energyA - a.energy
    if (fromB) fromB.offspring += energyB - b.energy
  }

  // Whatever a body still holds when it dies left as carrion; without that split the bill above
  // would read as maintenance the animal never paid.
  path.kill = (c: Creature, cause: DeathCause): void => {
    const rec = cohort.get(c.id)
    if (rec) {
      rec.carrion += c.energy
      rec.deaths[cause] = (rec.deaths[cause] ?? 0) + 1
      rec.endEnergy = 0
    }
    original.kill.call(sim, c, cause)
  }

  path.pickQuarry = (c: Creature): Creature | undefined => {
    const quarry = original.pickQuarry.call(sim, c)
    const rec = cohort.get(c.id)
    if (rec && quarry) rec.quarryChosen += 1
    return quarry
  }

  path.updateCreature = (c: Creature): void => {
    const rec = cohort.get(c.id)
    if (!rec) {
      original.updateCreature.call(sim, c)
      return
    }
    const energyIn = c.energy
    const meatIn = rec.meat
    const plantIn = rec.plant
    const offspringIn = rec.offspring
    const carrionIn = rec.carrion
    original.updateCreature.call(sim, c)
    rec.burnt +=
      energyIn + (rec.meat - meatIn) + (rec.plant - plantIn) - (rec.offspring - offspringIn) - (rec.carrion - carrionIn) - c.energy
    rec.ticksLived += 1
    if (c.behavior === BEHAVIOR_HUNT) rec.huntTicks += 1
    if (c.alive) {
      rec.endEnergy = c.energy
      if (c.energy > rec.peakEnergy) rec.peakEnergy = c.energy
    }
  }

  return () => {
    path.attack = original.attack
    path.behaveForage = original.behaveForage
    path.breed = original.breed
    path.kill = original.kill
    path.pickQuarry = original.pickQuarry
    path.updateCreature = original.updateCreature
  }
}

/**
 * What this animal is allowed to eat right now, and what the engine's chase rule makes of it.
 * Legality is the engine's own test; the payoffs and hunting costs below are the quantities its
 * `pursuitIsWorthwhile` weighs, reported so a refusal can be read as a price.
 */
function scanSupply(sim: Simulation, path: EnginePath, hunter: Creature, out: SupplyReading): void {
  const ph = hunter.phenotype
  const massCap = ph.mass * (0.35 + 1.7 * ph.diet)
  const room = Math.max(0, ph.maxEnergy - hunter.energy)
  const strikeRange = ph.speed + 0.6
  const huntTickCost = ph.basalRate + ph.moveCostCoefficient * ph.speed * ph.speed

  out.scans += 1
  out.senseRadiusSum += ph.senseRadius
  out.massCapSum += massCap
  out.strikeRangeSum += strikeRange
  out.huntTickCostSum += huntTickCost

  for (const other of sim.creatures) {
    if (!other.alive || other.id === hunter.id) continue
    const distance = Math.hypot(other.x - hunter.x, other.y - hunter.y)
    const inSight = distance <= ph.senseRadius

    if (!path.preyIsLegal.call(sim, hunter, other)) {
      if (!inSight) continue
      if (other.speciesId === hunter.speciesId) out.rejectSameSpecies += 1
      else if (other.age < other.phenotype.maturityAge) out.rejectTooYoung += 1
      else if (other.phenotype.mass >= massCap) out.rejectTooBig += 1
      else out.rejectTooThin += 1
      continue
    }

    out.legalInWorld += 1
    out.legalEnergyInWorld += other.energy
    if (distance < out.nearestLegalTiles) {
      out.nearestLegalTiles = distance
      out.nearestLegalEnergy = other.energy
    }
    if (!inSight) continue

    out.legalInSight += 1
    out.legalEnergyInSight += other.energy
    // The engine's own payoff, and the closing speed it computes the gap against.
    const payoff = Math.min(other.energy, room) * (0.45 + 0.45 * ph.digest)
    const flees = other.health >= 0.9 && other.energy > other.phenotype.maxEnergy * 0.45
    const closing = ph.speed - (flees ? other.phenotype.speed : 0)
    const chaseCost = closing > 0.05 ? huntTickCost * (distance / closing) : Number.POSITIVE_INFINITY

    if (path.pursuitIsWorthwhile.call(sim, hunter, other)) {
      out.chasable += 1
      out.chasableEnergy += other.energy
      if (payoff > out.bestAcceptedPayoff) {
        out.bestAcceptedPayoff = payoff
        out.bestAcceptedTiles = distance
      }
    } else {
      out.refused += 1
      out.refusedEnergy += other.energy
      if (payoff > out.bestRefusedPayoff) {
        out.bestRefusedPayoff = payoff
        out.bestRefusedTiles = distance
        out.bestRefusedCost = chaseCost
      }
    }
  }
}

function reportWindow(sim: Simulation, windowIndex: number, members: FounderRec[], supply: SupplyReading): void {
  const alive = members.filter((m) => m.self.alive)
  const rate = (pick: (m: FounderRec) => number): number => mean(members.map((m) => perLived(pick(m), m.ticksLived)))
  const scans = Math.max(1, supply.scans)
  const kills = rate((m) => m.kills)
  const burnt = rate((m) => m.burnt)
  const meat = rate((m) => m.meat)
  const plant = rate((m) => m.plant)
  const offspring = rate((m) => m.offspring)
  const carrion = rate((m) => m.carrion)
  const audit = sim.auditEnergy()
  const deaths: Partial<Record<DeathCause, number>> = {}
  for (const m of members) {
    for (const cause of DEATH_CAUSES) {
      const count = m.deaths[cause]
      if (count) deaths[cause] = (deaths[cause] ?? 0) + count
    }
  }

  console.log(
    [
      `window ${windowIndex}  founders ${members.length} alive at the start, ${alive.length} still alive at the end`,
      `  energy per animal per tick lived   meat ${num(meat, 4)}  plant ${num(plant, 4)}  burnt ${num(burnt, 4)}` +
        `  to offspring ${num(offspring, 4)}  carrion ${num(carrion, 4)}  net ${num(meat + plant - burnt - offspring - carrion, 4)}`,
      `  reserve   start ${num(mean(members.map((m) => m.startEnergy)), 1)}  end ${num(mean(members.map((m) => m.endEnergy)), 1)}` +
        `  peak ${num(mean(members.map((m) => m.peakEnergy)), 1)}  their own ceiling ${num(mean(members.map((m) => m.maxEnergy)), 1)}`,
      `  hunt chain   hunt ticks ${num(rate((m) => m.huntTicks), 2)} per animal-tick` +
        `  quarry committed ${num(rate((m) => m.quarryChosen), 2)}  strikes ${num(rate((m) => m.attacks), 3)}` +
        `  strikes that only wounded ${num(rate((m) => m.strikesMissed), 3)}  kills ${num(kills, 3)}` +
        `  energy taken from prey bodies ${num(rate((m) => m.preyBodyEnergy), 3)}`,
      supply.scans === 0
        ? `  supply   no founder left alive to scan`
        : [
            `  supply   ${supply.scans} scans${sampledNote}` +
              `  legal prey inside their own sense radius (mean radius ${num(supply.senseRadiusSum / scans, 1)}):` +
              ` ${num(supply.legalInSight / scans, 2)} animals holding ${num(supply.legalEnergyInSight / scans, 1)} energy`,
            `    animals in sight they were not allowed to eat   same species ${supply.rejectSameSpecies}` +
              `  not grown up ${supply.rejectTooYoung}  too big for their ${num(supply.massCapSum / scans, 2)} mass cap ${supply.rejectTooBig}` +
              `  body energy <= 0.2 ${supply.rejectTooThin}`,
            `    legal quarry anywhere in the world for this phenotype   ${num(supply.legalInWorld / scans, 0)} animals` +
              ` holding ${num(supply.legalEnergyInWorld / scans, 1)} energy` +
              `  nearest ${num(supply.nearestLegalTiles, 1)} tiles away holding ${num(supply.nearestLegalEnergy, 1)} energy`,
            `  chase gate   legal prey in sight the engine would commit to ${num(supply.chasable / scans, 2)}` +
              ` holding ${num(supply.chasableEnergy / scans, 1)} energy` +
              `   refused ${num(supply.refused / scans, 2)} holding ${num(supply.refusedEnergy / scans, 1)}`,
            `    best bite it would take   ${num(supply.bestAcceptedPayoff, 1)} energy at ${num(supply.bestAcceptedTiles, 1)} tiles` +
              `   best bite it turns down   ${num(supply.bestRefusedPayoff, 1)} energy at ${num(supply.bestRefusedTiles, 1)} tiles,` +
              ` closing that gap would cost ${num(supply.bestRefusedCost, 1)}`,
            `    their own terms   strike range ${num(supply.strikeRangeSum / scans, 2)} tiles` +
              `  hunting cost ${num(supply.huntTickCostSum / scans, 3)} energy per hunting tick` +
              `  one tick of hunting buys ${num(supply.huntTickCostSum / scans / Math.max(1e-9, 1), 3)} (see above for what a bite pays)`,
          ].join('\n'),
      `  deaths in this window   ${Object.entries(deaths).map(([cause, count]) => `${cause} ${count}`).join('  ') || 'none'}`,
      `  world   population ${sim.creatures.filter((c) => c.alive).length}` +
        `  biomass ${num(audit.biomass, 1)}  litter ${num(audit.detritus, 1)}  animal energy ${num(audit.creatures, 1)}` +
        `  ledger drift ${num(audit.delta, 3)}`,
    ].join('\n')
  )
}

const sampledNote = ` (${SAMPLED_ANIMALS} sampled animals x ${CHECKPOINTS} checkpoints)`

function runSeed(seed: string): void {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  const path = Object.getPrototypeOf(sim) as EnginePath
  const cohort = new Map<number, FounderRec>()
  for (const c of sim.creatures) {
    if (c.alive && c.phenotype.diet >= STRICT_DIET) cohort.set(c.id, newFounder(c))
  }
  const members = [...cohort.values()]
  const restore = instrument(sim, cohort)

  console.log(
    `\nseed ${seed}  default world ${config.world.width}x${config.world.height}` +
      `  strict meat-eater founders ${members.length}` +
      `  (diet ${num(mean(members.map((m) => m.diet)), 2)} mass ${num(mean(members.map((m) => m.mass)), 2)}` +
      ` speed ${num(mean(members.map((m) => m.speed)), 2)} sense ${num(mean(members.map((m) => m.senseRadius)), 1)}` +
      ` digest ${num(mean(members.map((m) => m.digest)), 2)} reserve ${num(mean(members.map((m) => m.maxEnergy)), 1)})`
  )

  try {
    const step = Math.max(1, Math.floor(WINDOW_TICKS / CHECKPOINTS))
    for (let windowIndex = 1; windowIndex <= WINDOWS; windowIndex += 1) {
      for (const m of members) {
        m.startEnergy = m.self.energy
        m.endEnergy = m.self.energy
        m.peakEnergy = Math.max(m.peakEnergy, m.self.energy)
        m.ticksLived = 0
        m.meat = 0
        m.plant = 0
        m.offspring = 0
        m.carrion = 0
        m.burnt = 0
        m.attacks = 0
        m.kills = 0
        m.strikesMissed = 0
        m.preyBodyEnergy = 0
        m.quarryChosen = 0
        m.huntTicks = 0
        m.deaths = {}
      }

      const supply = newSupplyReading()
      for (let checkpoint = 0; checkpoint < CHECKPOINTS; checkpoint += 1) {
        sim.run(step)
        const alive = members.filter((m) => m.self.alive).slice(0, SAMPLED_ANIMALS)
        for (const m of alive) scanSupply(sim, path, m.self, supply)
      }
      reportWindow(sim, windowIndex, members, supply)
      if (!members.some((m) => m.self.alive)) break
    }


  } finally {
    restore()
  }
}

for (const seed of SEEDS) runSeed(seed)
