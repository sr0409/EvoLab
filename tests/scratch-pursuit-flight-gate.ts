/**
 * Candidate (o) A/B: the chase gate priced with the engine's own prey-flight behaviour.
 * (PROGRESS.md §6D, §5, §8)
 *
 * `pursuitIsWorthwhile` decides which animals a hunter is willing to commit to chasing, so it is
 * the valve the whole strict band feeds through. Candidate (o) replaces its two-line model of prey
 * flight — "the quarry flees at full speed if it is healthy and above 45% of its reserve" — with
 * the flight behaviour the engine actually runs: a threat is only registered above a mass ratio
 * (engine.ts `updateCreature`), only sensed inside the lesser of the quarry's sense radius and
 * `FLEE_INITIATION_DISTANCE`, a wounded animal stands its ground at a quarter reserve rather than
 * a whole one, and the quarry can only run as far as its reserve stands above that threshold.
 *
 * The two arms of this probe are one gate apart, and that gate is swapped on the instance:
 *   baseline  the gate as committed, reinstated verbatim from `git show HEAD:src/sim/engine.ts`;
 *   candidate the gate as modified in the working tree (engine.ts 901-961).
 * Everything else — world, founders, every other rule — is the same code path in both arms, so the
 * baseline arm must reproduce the recorded run of the committed engine (band 0 / 0 / 20 at the
 * 3000-tick census, populations 3197 / 3191 / 2346, predation 601 / 151 / 16782). If it does not,
 * the arms are not one gate apart and nothing printed here means anything.
 *
 * The observation is the engine's own decisions, not a re-implementation of them: the probe wraps
 * the engine's own `pursuitIsWorthwhile` call and records what it answered — how many legal animals
 * in sight it committed to and how many it wrote off, with the payoff a bite would have paid and the
 * distance it turned down. Every refusal is also priced against an unescapable floor: the cost of
 * crossing the same gap at the hunter's own speed with the quarry standing still. A refusal whose
 * payoff clears that floor is a refusal the pricing caused; one below it would be refused under any
 * model. The hunt chain (hunting ticks, quarry committed to, strikes, strikes that only wounded,
 * kills, energy taken from prey bodies) and the cohort's reserves are taken from the engine's own
 * calls and accounts by the same wrappers `tests/scratch-meat-supply.ts` uses. The census of the
 * strict band is the one `tests/scratch-subadult-founders.ts` reports. No wrapper consumes
 * randomness, so the arms see the same world.
 *
 *   npx vite-node tests/scratch-pursuit-flight-gate.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'
import { BEHAVIOR_HUNT } from '../src/sim/types'
import type { DeathCause } from '../src/sim/types'

const SEEDS = ['evolab', 'evolab-2', 'evolab-3']
const TICKS = 3000
const CHUNK = 250
const STRICT = 0.66

/**
 * The census of the engine as committed (the post-(m) tree). The baseline arm of this probe
 * reinstates the committed chase gate and must reproduce these values exactly.
 */
const RECORDED_BASELINE: Record<string, { band: number; population: number; predation: number }> = {
  evolab: { band: 0, population: 3197, predation: 601 },
  'evolab-2': { band: 0, population: 3191, predation: 151 },
  'evolab-3': { band: 20, population: 2346, predation: 16782 },
}

const dietOf = (c: { genome: Float32Array }): number => c.genome[TRAIT_INDEX.diet]
const isStrict = (c: { genome: Float32Array }): boolean => dietOf(c) > STRICT

/** The engine's own predation and decision path, reached through the instance. */
interface EnginePath {
  attack: (c: Creature, prey: Creature) => void
  behaveForage: (c: Creature) => number
  breed: (a: Creature, b: Creature) => void
  kill: (c: Creature, cause: DeathCause) => void
  updateCreature: (c: Creature) => void
  pickQuarry: (c: Creature) => Creature | undefined
  pursuitIsWorthwhile: (c: Creature, quarry: Creature) => boolean
}

/**
 * The gate as committed, taken from the first four clauses and the flight clauses of
 * `git show HEAD:src/sim/engine.ts`. Kept verbatim so the baseline arm is the committed engine
 * and not an approximation of it.
 */
function committedPursuitIsWorthwhile(c: Creature, quarry: Creature): boolean {
  const ph = c.phenotype
  const dist = Math.hypot(quarry.x - c.x, quarry.y - c.y)

  // A gap already within one stride costs nothing extra to attempt: strike.
  if (dist < ph.speed + 0.6) return true

  // A quarry only truly escapes if it can pay for running; wounded and
  // desperate prey stand their ground, which is what makes them reachable.
  // Mirrors the prey's own flight gate in the decision flow.
  const preyFlees =
    quarry.health >= 0.9 && quarry.energy > quarry.phenotype.maxEnergy * 0.45
  const closing = ph.speed - (preyFlees ? quarry.phenotype.speed : 0)
  if (closing <= 0.05) return false // cannot gain at all

  const room = Math.max(0, ph.maxEnergy - c.energy)
  const payoff = Math.min(quarry.energy, room) * (0.45 + 0.45 * ph.digest)
  const huntTickCost = ph.basalRate + ph.moveCostCoefficient * ph.speed * ph.speed
  const expectedCost = huntTickCost * (dist / closing)
  return expectedCost <= payoff
}
// NOTE: the committed body computes `room`/`payoff` before the flight clauses; the order of the
// arithmetic does not change the value, and this ordering is the one its own comments describe.

const isYoung = (c: Creature): boolean => c.age < c.phenotype.maturityAge

const num = (value: number, digits: number): string => (Number.isFinite(value) ? value.toFixed(digits) : 'n/a')
const mean = (values: number[]): number => (values.length ? values.reduce((s, v) => s + 0 + v, 0) / values.length : 0)
/** Rates are per animal-tick actually lived, so a short life is not read as a cheap one. */
const perLived = (total: number, ticks: number): number => (ticks > 0 ? total / ticks : 0)

/** One animal's whole energy ledger, read out of the engine's own accounts. */
interface CohortRec {
  id: number
  /** The creature object, kept so its numbers can still be read after it dies. */
  self: Creature
  diet: number
  mass: number
  speed: number
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
  /** What the prey's body held at the moment of the strike, as distinct from what was absorbed. */
  preyBodyEnergy: number
  quarryCommitted: number
  huntTicks: number
  deaths: Partial<Record<DeathCause, number>>
}

function newRec(c: Creature): CohortRec {
  const ph = c.phenotype
  return {
    id: c.id,
    self: c,
    diet: ph.diet,
    senseRadius: ph.senseRadius,
    maxEnergy: ph.maxEnergy,
    basalRate: ph.basalRate,
    moveCostCoefficient: ph.moveCostCoefficient,
    mass: ph.mass,
    speed: ph.speed,
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
    quarryCommitted: 0,
    huntTicks: 0,
    deaths: {},
  }
}

/**
 * What the engine's own chase rule answered about the animals a hunter is allowed to eat.
 * Every number here is either taken from the engine's own calls or is a price the rule is being
 * asked about; the probe never decides reachability itself. The one model-free quantity is the walk
 * cost: what it would cost the hunter to cross the same gap at its own speed with the quarry
 * standing still. A refusal whose bite pays more than that is a refusal the pricing produced, not a
 * refusal the quarry's legs deserved.
 */
interface GateReading {
  /** Calls the engine made on an animal inside the strict band. */
  calls: number
  accepted: number
  acceptedInStrikeRange: number
  refused: number
  refusedFitQuarry: number
  refusedAtOrAboveSpeed: number
  refusedPricedAway: number
  refusedPayoffSum: number
  refusedWalkCostSum: number
  refusedTilesSum: number
  acceptedPayoffSum: number
  acceptedTilesSum: number
  bestPricedAwayPayoff: number
  bestPricedAwayTiles: number
  bestPricedAwayWalkCost: number
}

function newReading(): GateReading {
  return {
    calls: 0,
    accepted: 0,
    acceptedInStrikeRange: 0,
    refused: 0,
    refusedFitQuarry: 0,
    refusedAtOrAboveSpeed: 0,
    refusedPricedAway: 0,
    refusedPayoffSum: 0,
    refusedWalkCostSum: 0,
    refusedTilesSum: 0,
    acceptedPayoffSum: 0,
    acceptedTilesSum: 0,
    bestPricedAwayPayoff: 0,
    bestPricedAwayTiles: 0,
    bestPricedAwayWalkCost: 0,
  }
}

/**
 * Records what the engine's own chase rule answered about strict carnivores, and keeps the
 * founding band's energy ledger out of the engine's accounts, exactly as `scratch-meat-supply.ts`
 * reads them. No wrapper decides anything or consumes randomness; each one calls the engine's own
 * method, records what it returned or what the animal's accounts show, and passes the result on.
 */
function instrument(
  sim: Simulation,
  cohort: Map<number, CohortRec>,
  reading: GateReading,
  bandDeaths: Map<string, number>,
): () => void {
  const path = Object.getPrototypeOf(sim) as EnginePath
  const original = {
    attack: path.attack,
    behaveForage: path.behaveForage,
    breed: path.breed,
    kill: path.kill,
    updateCreature: path.updateCreature,
    pickQuarry: path.pickQuarry,
    pursuitIsWorthwhile: path.pursuitIsWorthwhile,
  }

  // The engine's own answer, plus the quantities a refusal is being priced against. The payoff and
  // hunt-tick cost are the terms the committed gate itself computes; the walk cost is the same
  // price with the quarry standing still, which no flight model can make the hunter pay twice.
  const recordCall = (c: Creature, quarry: Creature, answer: boolean): void => {
    const ph = c.phenotype
    const dist = Math.hypot(quarry.x - c.x, quarry.y - c.y)
    const room = Math.max(0, ph.maxEnergy - c.energy)
    const payoff = Math.min(quarry.energy, room) * (0.45 + 0.45 * ph.digest)
    const huntTickCost = ph.basalRate + ph.moveCostCoefficient * ph.speed * ph.speed
    const walkCost = huntTickCost * (dist / ph.speed)

    reading.calls += 1
    if (answer) {
      reading.accepted += 1
      reading.acceptedPayoffSum += payoff
      reading.acceptedTilesSum += dist
      if (dist < ph.speed + 0.6) reading.acceptedInStrikeRange += 1
      return
    }
    reading.refused += 1
    reading.refusedPayoffSum += payoff
    reading.refusedTilesSum += dist
    reading.refusedWalkCostSum += walkCost
    if (quarry.health >= 0.9 && quarry.energy > quarry.phenotype.maxEnergy * 0.45) reading.refusedFitQuarry += 1
    if (quarry.phenotype.speed >= ph.speed) reading.refusedAtOrAboveSpeed += 1
    if (payoff > walkCost) {
      reading.refusedPricedAway += 1
      if (payoff > reading.bestPricedAwayPayoff) {
        reading.bestPricedAwayPayoff = payoff
        reading.bestPricedAwayTiles = dist
        reading.bestPricedAwayWalkCost = walkCost
      }
    }
  }

  path.pursuitIsWorthwhile = (c: Creature, quarry: Creature): boolean => {
    const answer = original.pursuitIsWorthwhile.call(sim, c, quarry)
    if (isStrict(c)) recordCall(c, quarry, answer)
    return answer
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

  // Whatever a body still holds when it dies left as carrion; without that split the bill would
  // read as maintenance the animal never paid. Every strict death is also tallied, founding or
  // recruit, juvenile or adult, because which members the band loses is part of the verdict.
  path.kill = (c: Creature, cause: DeathCause): void => {
    const rec = cohort.get(c.id)
    if (rec) {
      rec.carrion += c.energy
      rec.deaths[cause] = (rec.deaths[cause] ?? 0) + 1
      rec.endEnergy = 0
    }
    if (isStrict(c)) {
      const key = `${cohort.has(c.id) ? 'founding' : 'recruit'} ${isYoung(c) ? 'juvenile' : 'adult'} ${cause}`
      bandDeaths.set(key, (bandDeaths.get(key) ?? 0) + 1)
    }
    original.kill.call(sim, c, cause)
  }

  path.pickQuarry = (c: Creature): Creature | undefined => {
    const quarry = original.pickQuarry.call(sim, c)
    const rec = cohort.get(c.id)
    if (rec && quarry) rec.quarryCommitted += 1
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
    path.updateCreature = original.updateCreature
    path.pickQuarry = original.pickQuarry
    path.pursuitIsWorthwhile = original.pursuitIsWorthwhile
  }
}

interface Row {
  tick: number
  band: number
  founding: number
  recruits: number
  recruitsAdult: number
  population: number
  /** Predation deaths in the whole herd over this window, from the engine's own death totals. */
  predation: number
}

interface RunResult {
  seed: string
  baseline: boolean
  foundingCount: number
  rows: Row[]
  peakBand: number
  reading: GateReading
  bandDeaths: Map<string, number>
  endRow: Row
  /** Inherited diets carried by the band at the final census, bucketed as the other probes do. */
  spread: { count: number; mean: number; buckets: number[] }
  cohort: CohortRec[]
}

function census(sim: Simulation, founding: Set<number>): { band: number; founding: number; recruits: number; recruitsAdult: number; population: number } {
  let band = 0
  let foundingCount = 0
  let recruits = 0
  let recruitsAdult = 0
  let population = 0
  for (const c of sim.creatures) {
    if (!c.alive) continue
    population += 1
    if (!isStrict(c)) continue
    band += 1
    if (founding.has(c.id)) {
      foundingCount += 1
    } else {
      recruits += 1
      if (!isYoung(c)) recruitsAdult += 1
    }
  }
  return { band, founding: foundingCount, recruits, recruitsAdult, population }
}

/** Inherited diets carried by the band at a census, bucketed as the other probes report them. */
function bandSpread(sim: Simulation): { count: number; mean: number; buckets: number[] } {
  const out = { count: 0, mean: 0, buckets: [0, 0, 0, 0] }
  for (const c of sim.creatures) {
    if (!c.alive || !isStrict(c)) continue
    const d = dietOf(c)
    out.buckets[d < 0.7 ? 0 : d < 0.8 ? 1 : d < 0.9 ? 2 : 3] += 1
    out.count += 1
    out.mean += d
  }
  if (out.count) out.mean /= out.count
  return out
}

function run(seed: string, useBaselineGate: boolean): RunResult {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  const path = Object.getPrototypeOf(sim) as EnginePath

  // The one difference between the arms: the committed gate written back over the working-tree
  // gate on the instance, restored in the finally below so the arms never see each other.
  const engineGate = path.pursuitIsWorthwhile
  if (useBaselineGate) path.pursuitIsWorthwhile = committedPursuitIsWorthwhile

  const founding = new Set<number>()
  const cohort = new Map<number, CohortRec>()
  for (const c of sim.creatures) {
    if (!c.alive || !isStrict(c)) continue
    founding.add(c.id)
    cohort.set(c.id, newRec(c))
  }

  const reading = newReading()
  const bandDeaths = new Map<string, number>()
  const restore = instrument(sim, cohort, reading, bandDeaths)

  const rows: Row[] = []
  let peakBand = 0
  let predationBefore = 0
  try {
    for (let window = 1; window * CHUNK <= TICKS; window++) {
      sim.run(CHUNK)
      const c = census(sim, founding)
      if (c.band > peakBand) peakBand = c.band
      const predation = sim.deathTotals().predation - predationBefore
      predationBefore += predation
      rows.push({ tick: window * CHUNK, ...c, predation })
    }
  } finally {
    restore()
    path.pursuitIsWorthwhile = engineGate
  }

  return {
    seed,
    baseline: useBaselineGate,
    foundingCount: founding.size,
    rows,
    peakBand,
    reading,
    bandDeaths,
    endRow: rows[rows.length - 1],
    spread: bandSpread(sim),
    cohort: [...cohort.values()],
  }
}

function describeReading(r: GateReading): string {
  if (!r.calls) return '    no strict carnivore reached the chase decision in this run'
  const share = (n: number): string => `${((100 * n) / Math.max(1, r.refused)).toFixed(0)}% of refusals`
  const perAccepted = (n: number): number => n / Math.max(1, r.accepted)
  const perRefused = (n: number): number => n / Math.max(1, r.refused)
  return [
    `    ${r.calls} calls about animals these hunters may eat: committed to ${r.accepted}, turned down ${r.refused}`,
    `    committed   mean bite ${num(perAccepted(r.acceptedPayoffSum), 1)} energy at ${num(perAccepted(r.acceptedTilesSum), 1)} tiles;` +
      ` ${r.acceptedInStrikeRange} of these were already inside strike range`,
    `    turned down   mean bite ${num(perRefused(r.refusedPayoffSum), 1)} energy at ${num(perRefused(r.refusedTilesSum), 1)} tiles,` +
      ` crossing the same gap at the hunter's own speed with the quarry standing still would have cost ${num(perRefused(r.refusedWalkCostSum), 1)}`,
    `    the pricing explains   the bite would have covered that walk cost on its own: ${r.refusedPricedAway} (${share(r.refusedPricedAway)})` +
      (r.bestPricedAwayPayoff > 0
        ? `  best such bite ${num(r.bestPricedAwayPayoff, 1)} energy at ${num(r.bestPricedAwayTiles, 1)} tiles, crossing it would have cost ${num(r.bestPricedAwayWalkCost, 1)}`
        : ''),
    `    any flight model explains   quarry the committed model calls fleeing (whole, above 45% reserve): ${r.refusedFitQuarry}` +
      `  quarry at or above the hunter's own speed: ${r.refusedAtOrAboveSpeed}`,
  ].join('\n')
}

function formatBuckets(s: { count: number; mean: number; buckets: number[] }): string {
  if (!s.count) return 'no band members at this census'
  return (
    `n=${s.count} mean ${s.mean.toFixed(3)} ` +
    `[0.66-0.70 ${s.buckets[0]}] [0.70-0.80 ${s.buckets[1]}] ` +
    `[0.80-0.90 ${s.buckets[2]}] [0.90+ ${s.buckets[3]}]`
  )
}

function reportRun(result: RunResult): void {
  const arm = result.baseline
    ? 'baseline arm — the committed chase gate, reinstated at runtime'
    : 'candidate arm — the chase gate priced with the engine\u2019s own prey-flight behaviour'
  console.log(`\n--- seed ${result.seed} — ${arm} ---`)
  const cohort = result.cohort
  console.log(
    `  founding band   ${cohort.length} animals, inherited diets ${num(mean(cohort.map((r) => r.diet)), 3)}` +
      `  mass ${num(mean(cohort.map((r) => r.mass)), 1)}  speed ${num(mean(cohort.map((r) => r.speed)), 2)}` +
      `  sense ${num(mean(cohort.map((r) => r.senseRadius)), 1)}`,
  )
  for (const r of result.rows) {
    console.log(
      `  tick ${String(r.tick).padStart(4)}  strict=${String(r.band).padStart(3)}` +
        ` founding=${String(r.founding).padStart(3)} recruits=${String(r.recruits).padStart(3)}` +
        ` recruitsAdult=${String(r.recruitsAdult).padStart(3)}  population ${String(r.population).padStart(5)}` +
        `  predation this window ${String(r.predation).padStart(5)}`,
    )
  }
  const alive = cohort.filter((r) => r.self.alive)
  const sum = (pick: (r: CohortRec) => number): number => cohort.reduce((s, r) => s + pick(r), 0)
  console.log(
    `  founding cohort   ${cohort.length} tracked, ${alive.length} alive at ${TICKS}` +
      `  peak band any census ${result.peakBand}`,
  )
  console.log(
    `  hunt chain   hunting ticks ${sum((r) => r.huntTicks)}  quarry committed ${sum((r) => r.quarryCommitted)}` +
      `  strikes ${sum((r) => r.attacks)} (only wounded ${sum((r) => r.strikesMissed)})  kills ${sum((r) => r.kills)}` +
      `  energy taken ${num(sum((r) => r.meat), 1)} from bodies holding ${num(sum((r) => r.preyBodyEnergy), 1)}`,
  )
  const lived = cohort.reduce((s, r) => s + r.ticksLived, 0)
  console.log(
    `  cohort energy   meat ${num(perLived(sum((r) => r.meat), lived), 4)} plants ${num(perLived(sum((r) => r.plant), lived), 4)}` +
      `  to offspring ${num(perLived(sum((r) => r.offspring), lived), 4)}  burnt ${num(perLived(sum((r) => r.burnt), lived), 4)}` +
      `  left as carrion ${num(perLived(sum((r) => r.carrion), lived), 4)} (per animal-tick lived, ${lived} animal-ticks)`,
  )
  if (result.bandDeaths.size) {
    console.log(`  band deaths attributed   ${[...result.bandDeaths.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`)
  }
  console.log(`  chase gate as the engine answered it`)
  console.log(describeReading(result.reading))
  console.log(`  inherited diets at the final census   ${formatBuckets(result.spread)}`)
}

function main(): void {
  let reproduced = true
  const outcomes: { seed: string; baseline: number; candidate: number }[] = []
  for (const seed of SEEDS) {
    console.log(`\n================ seed ${seed} ================`)
    const baseline = run(seed, true)
    reportRun(baseline)
    const expected = RECORDED_BASELINE[seed]
    const totalPredation = baseline.rows.reduce((s, r) => s + r.predation, 0)
    const ok =
      baseline.endRow.band === expected.band &&
      baseline.endRow.population === expected.population &&
      totalPredation === expected.predation
    reproduced = reproduced && ok
    console.log(
      `  baseline at tick ${TICKS}: band ${baseline.endRow.band} population ${baseline.endRow.population}` +
        ` predation ${totalPredation}   recorded: band ${expected.band} population ${expected.population}` +
        ` predation ${expected.predation}   -> ${ok ? 'reproduced' : 'NOT REPRODUCED'}`,
    )
    const candidate = run(seed, false)
    reportRun(candidate)
    outcomes.push({ seed, baseline: baseline.endRow.band, candidate: candidate.endRow.band })
  }

  console.log(`\n================ candidate (o) verdict ================`)
  console.log(
    `baseline reproduction: ${reproduced ? 'exact on all three seeds' : 'FAILED — the arms are not one gate apart; nothing below can be trusted'}`,
  )
  let passes = 0
  for (const o of outcomes) {
    const aliveBand = o.candidate > 0
    if (aliveBand) passes += 1
    console.log(
      `seed ${o.seed}: band at the 3000-tick census baseline ${o.baseline} -> candidate ${o.candidate}` +
        ` ${aliveBand ? 'ALIVE' : 'dead'}`,
    )
  }
  console.log(`pass bar: strict band alive at the 3000-tick census on at least 2 of 3 seeds -> ${passes} of 3`)
  console.log(`candidate (o) ${reproduced && passes >= 2 ? 'PASSES' : 'does not pass'}`)
}

main()
