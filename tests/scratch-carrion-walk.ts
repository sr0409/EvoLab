/**
 * Candidate (q): carrion a carnivore has to walk to.
 *
 * Candidate (p) (tests/scratch-carrion-scavenge.ts) put carrion in the world and let a
 * strict carnivore eat what was standing on its own tile. The pool was there — several
 * hundred units of it at any census — and almost none of it was ever eaten, because the
 * animals that could eat it were standing a few tiles away. Candidate (q) is the step (p)
 * did not take: an animal scans its own perception radius for carrion, works out what one
 * bite of each carcass can deliver into its own reserve against the cost of the ticks the
 * walk takes at its own speed, walks to the best-paying carcass, and eats when it gets
 * there.
 *
 * Three arms. `feet` and `walk` share the carrion pool and every rule that feeds and
 * sinks it, so the only thing that differs between them is the feeding decision:
 *   off   the committed engine, untouched. It must reproduce the recorded census (band
 *         0 / 0 / 20, populations 3197 / 3191 / 2346, predation 601 / 151 / 16782 at the
 *         3000-tick census) or nothing printed below means anything;
 *   feet  candidate (p): the pool is fed by the part of a kill a predator could not
 *         absorb and by the bodies of animals that died of any other cause; a strict
 *         carnivore eats only carrion standing on the tile it is itself standing on;
 *   walk  candidate (q): the same pool, the same sources, the same sinking rule, plus the
 *         search-and-price step. The animal weighs the nearest quarry the engine would
 *         already have picked against the best-paying carcass in sight and goes to
 *         whichever is the closer meal.
 *
 * All of it is installed at runtime by replacing the private methods on
 * `Object.getPrototypeOf(sim)` and on the world's prototype, and every replacement is
 * reverted afterwards. Nothing in `src/` is modified. No added rule draws a random
 * number, so the `off` arm is bit-identical to the committed run and the two candidate
 * arms differ from it only in what they eat.
 *
 * The walk price is the engine's own investment shape. `pursuitIsWorthwhile` already
 * prices a chase as (what one kill delivers into this animal's reserve) against (the
 * engine's hunt-tick cost, `basalRate + moveCostCoefficient * speed^2`, times the ticks
 * needed to close the gap). A carcass does not run away, so the closing speed is simply
 * this animal's own speed, and the payoff is one bite of carrion at the same absorption
 * rate the engine pays for every other animal meal.
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'
import { BEHAVIOR_REST, type DeathCause } from '../src/sim/types'
import type { EnvState, EnergyFlux } from '../src/sim/world'

const TICKS = 3000
const CHUNK = 250
const WINDOWS = TICKS / CHUNK
const STRICT = 0.66
const SEEDS = ['evolab', 'evolab-3', 'evolab-2']

/** The carrion constants, exactly as candidates p and q recorded them. */
const CARRION_MAX = 30
const CARRION_SINK = 0.03

/** The engine's own strike reach: `behaveHunt` lands a bite when the gap closes under `speed + 0.6`. */
const STRIKE = 0.6

type Mode = 'off' | 'feet' | 'walk'
const MODES: Mode[] = ['off', 'feet', 'walk']
const LABEL: Record<Mode, string> = {
  off: 'off  (the committed engine)',
  feet: 'feet  (candidate p: eat the carrion at your own feet)',
  walk: 'walk  (candidate q: find a carcass, price the walk, eat it)',
}

/** The committed engine's census at the 3000-tick census, as §6D records it. */
const BASELINE: Record<string, { band: number; population: number; predation: number }> = {
  evolab: { band: 0, population: 3197, predation: 601 },
  'evolab-2': { band: 0, population: 3191, predation: 151 },
  'evolab-3': { band: 20, population: 2346, predation: 16782 },
}

/** The private engine methods the carrion rules have to sit inside. */
interface EnginePath {
  attack: (c: Creature, prey: Creature) => void
  behaveForage: (c: Creature) => number
  behaveHunt: (c: Creature) => number
  juvenilePlantAllowance: (c: Creature) => number
  deposit: (tile: number, amount: number) => void
  kill: (c: Creature, cause: DeathCause) => void
  moveToward: (c: Creature, tx: number, ty: number, speedScale?: number) => number
  pickQuarry: (c: Creature) => Creature | undefined
  pickWanderTarget: (c: Creature) => void
}

interface EngineInternals {
  deathsSinceCensus: number
  ledger: { burial: number }
}

const dietOf = (c: Creature): number => c.genome[TRAIT_INDEX.diet]
const isStrict = (c: Creature): boolean => dietOf(c) > STRICT
const isYoung = (c: Creature): boolean => c.age < c.phenotype.maturityAge

/**
 * The animals the carrion rules are able to feed, which is a different set from the band.
 * The band (§6D's measure) is inherited diet above 0.66. This one is inherited diet at or
 * above 0.7: the engine's own boundary for an animal being a meat-eater at all, the value
 * `pickCarrion` refuses below and the value `attack` pays for. An animal inside the band
 * but under 0.7 is counted in `band` and not in `carnivores`, because for that animal the
 * carrion rule is not on the table.
 */
const CARNIVORE_DIET = 0.7
const isCarnivore = (c: Creature): boolean => dietOf(c) >= CARNIVORE_DIET

interface Row {
  tick: number
  band: number
  carnivores: number
  carrion: number
  /** Distance from each strict carnivore to the nearest carrion anywhere in the pool. */
  nearestMean: number
  nearestMax: number
  population: number
  predation: number
  /** Running totals at this census, so a window's own figures are the difference of two rows. */
  carrionEaten: number
  carrionMeals: number
  walkAsked: number
  walkChose: number
}

interface RunResult {
  seed: string
  mode: Mode
  rows: Row[]
  endRow: Row
  bandPeak: number
  carnivorePeak: number
  poolPeak: number
  fromKills: number
  fromCorpses: number
  carrionEaten: number
  carrionMeals: number
  carrionSunk: number
  carrionBuried: number
  /** What the walk rule was asked, and what it answered. */
  asked: number
  choseWalk: number
  refusedNoRoom: number
  refusedWalkCost: number
  /** Meals taken at carrion standing on the animal's own tile, and at a carcass the search-and-price rule committed to. */
  feetMeals: number
  walkMeals: number
  carrionBurialFromSink: number
  bandDeaths: Map<string, number>
  bandStarved: number
  bandStarvedYoung: number
  carnivoreCensus: number
  predation: number
  starvation: number
  naturalDeaths: number
}

function run(seed: string, mode: Mode): RunResult {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  const world = sim.world
  const internals = sim as unknown as EngineInternals

  const carrion = new Float32Array(world.size)
  let fromKills = 0
  let fromCorpses = 0
  let carrionEaten = 0
  let carrionMeals = 0
  let carrionSunk = 0
  let carrionBuried = 0
  let asked = 0
  let choseWalk = 0
  let refusedNoRoom = 0
  let refusedWalkCost = 0
  let feetMeals = 0
  let walkMeals = 0
  let carrionBurialFromSink = 0

  const putCarrion = (tile: number, amount: number, source: 'kill' | 'corpse'): void => {
    if (amount <= 0) return
    const held = carrion[tile]
    const room = CARRION_MAX - held
    const taken = Math.min(amount, room)
    carrion[tile] = held + taken
    if (amount > taken) {
      carrionBuried += amount - taken
      internals.ledger.burial += amount - taken
    }
    if (taken > 0) {
      if (source === 'kill') fromKills += taken
      else fromCorpses += taken
    }
  }

  const takeCarrion = (tile: number, amount: number): number => {
    if (amount <= 0) return 0
    const held = carrion[tile]
    if (held <= 0) return 0
    const taken = Math.min(held, amount)
    carrion[tile] = held - taken
    return taken
  }

  const totalCarrion = (): number => {
    let sum = 0
    for (let i = 0; i < carrion.length; i++) sum += carrion[i]
    return sum
  }

  const path = Object.getPrototypeOf(sim) as EnginePath
  const originals: EnginePath = {
    attack: path.attack,
    behaveForage: path.behaveForage,
    behaveHunt: path.behaveHunt,
    juvenilePlantAllowance: path.juvenilePlantAllowance,
    deposit: path.deposit,
    kill: path.kill,
    moveToward: path.moveToward,
    pickQuarry: path.pickQuarry,
    pickWanderTarget: path.pickWanderTarget,
  }
  const worldPath = Object.getPrototypeOf(world) as {
    stepVegetation: (env: EnvState, flux: EnergyFlux) => void
  }

  /**
   * The meal both candidate arms use, candidate (p)'s rule exactly: carrion is eaten at
   * the bite size and absorption rate the engine already uses for animal food, and what
   * the gut cannot take is left where it lies, as litter, as it does for any meal.
   */
  const eatCarrion = (c: Creature, tile: number): boolean => {
    const ph = c.phenotype
    const room = ph.maxEnergy - c.energy
    if (room <= 0) return false
    const eaten = takeCarrion(tile, Math.min(ph.bitePrey, room))
    if (eaten <= 0) return false
    const absorbed = Math.min(room, eaten * (0.45 + 0.45 * ph.digest))
    c.energy += absorbed
    if (eaten > absorbed) originals.deposit.call(sim, tile, eaten - absorbed)
    carrionEaten += eaten
    carrionMeals += 1
    return true
  }

  /**
   * Candidate (q)'s decision: which carcass, if any, is worth walking to. Nothing here
   * assumes the nearest or the largest carcass is the good one. Every carrion tile inside
   * this animal's own perception is priced the way `pursuitIsWorthwhile` prices a chase —
   * what one bite can actually deliver into this animal's reserve, against the engine's
   * own hunt-tick cost (`basalRate + moveCostCoefficient * speed^2`) for the ticks it
   * takes to cross the gap at this animal's own speed. A carcass that cannot pay for its
   * own walk is not walked to. The scan moves nothing and draws no random number: an arm
   * that never commits is bit-identical to the engine it replaced.
   */
  const pickCarrion = (c: Creature): number => {
    const ph = c.phenotype
    // Animal-eaters only: this is the band candidate (q) was proposed for.
    if (ph.diet < 0.7) return -1
    const room = ph.maxEnergy - c.energy
    asked += 1
    if (room <= 0.01) {
      refusedNoRoom += 1
      return -1
    }
    const gutFill = 0.45 + 0.45 * ph.digest
    const huntTickCost = ph.basalRate + ph.moveCostCoefficient * ph.speed * ph.speed
    const range = Math.max(1, Math.ceil(ph.senseRadius))
    const cx = Math.floor(c.x)
    const cy = Math.floor(c.y)
    let best = -1
    let bestNet = 0
    for (let y = Math.max(0, cy - range); y <= Math.min(world.height - 1, cy + range); y++) {
      for (let x = Math.max(0, cx - range); x <= Math.min(world.width - 1, cx + range); x++) {
        const tile = y * world.width + x
        const amount = carrion[tile]
        if (amount <= 0) continue
        const dist = Math.hypot(x + 0.5 - c.x, y + 0.5 - c.y)
        const gain = Math.min(ph.bitePrey, amount, room / gutFill) * gutFill
        const net = gain - (dist / ph.speed) * huntTickCost
        if (net <= 0) continue
        if (net > bestNet) {
          bestNet = net
          best = tile
        }
      }
    }
    if (best >= 0) {
      choseWalk += 1
      return best
    }
    refusedWalkCost += 1
    return -1
  }

  /**
   * The candidate arms. `attack` and `kill` are the committed engine's own methods,
   * verbatim except for the one difference each is allowed: what a predator's own gut
   * could not take stays at the quarry's tile as carrion, and a body that died of any
   * cause other than predation — already emptied by `attack` if it was taken by one —
   * becomes carrion instead of litter. The `behaveHunt` below is the committed engine's
   * verbatim, with the arm's meal step inserted exactly where candidate (q)'s branch sat
   * in the candidate engine: after the no-quarry test and before the juvenile plant
   * allowance, so an animal with carrion in reach eats instead of walking or waiting.
   */
  const killToCarrion = (c: Creature, cause: DeathCause): void => {
    if (!c.alive) return
    c.alive = false
    internals.deathsSinceCensus += 1
    sim.deathsByCause[cause] += 1
    if (c.energy > 0) {
      const tile = Math.floor(c.y) * world.width + Math.floor(c.x)
      if (cause === 'predation') originals.deposit.call(sim, tile, c.energy)
      else putCarrion(tile, c.energy, 'corpse')
      c.energy = 0
    }
  }

  if (mode !== 'off') {
    path.attack = (c: Creature, prey: Creature): void => {
      const ph = c.phenotype
      const damage = (0.1 + 0.5 * ph.aggression) * (0.4 + 0.6 * ph.speed)
      prey.health -= damage
      if (prey.health > 0) return
      const transferable = prey.energy
      const room = ph.maxEnergy - c.energy
      const absorbed = Math.min(room, transferable * (0.45 + 0.45 * ph.digest))
      c.energy += absorbed
      const leftover = transferable - absorbed
      const tile = Math.floor(prey.y) * world.width + Math.floor(prey.x)
      if (leftover > 0) putCarrion(tile, leftover, 'kill')
      prey.energy = 0
      c.kills += 1
      originals.kill.call(sim, prey, 'predation')
    }
  }

  // The candidate arms' `kill`: the engine's own method verbatim, except that a body which
  // was not emptied by a predator's bite becomes carrion on its own tile instead of litter.
  // A predation corpse is handled by `attack` above (the engine empties the prey before
  // calling `kill`), so it keeps the engine's litter path exactly as the committed run has it.
  const originalKill = path.kill
  const bandDeaths = new Map<string, number>()
  path.kill = (c: Creature, cause: DeathCause): void => {
    if (isStrict(c)) {
      const key = `${cause}${isYoung(c) ? ' (before maturityAge)' : ''}`
      bandDeaths.set(key, (bandDeaths.get(key) ?? 0) + 1)
    }
    if (mode === 'off') {
      originalKill.call(sim, c, cause)
      return
    }
    killToCarrion(c, cause)
  }

  if (mode === 'feet') {
    // Candidate (p), the arm that measured the problem this candidate is the answer to.
    path.behaveHunt = (c: Creature): number => {
      const ph = c.phenotype
      if (ph.diet < 0.2) return originals.behaveForage.call(sim, c)
      const quarry = originals.pickQuarry.call(sim, c)
      if (quarry) {
        const dist = Math.hypot(quarry.x - c.x, quarry.y - c.y)
        if (dist < ph.speed + 0.6) {
          path.attack.call(sim, c, quarry)
          return 0
        }
        c.tx = quarry.x
        c.ty = quarry.y
        return originals.moveToward.call(sim, c, quarry.x, quarry.y)
      }
      if (ph.diet < 0.7) return originals.behaveForage.call(sim, c)
      if (eatCarrion(c, Math.floor(c.y) * world.width + Math.floor(c.x))) {
        feetMeals += 1
        return 0
      }
      if (originals.juvenilePlantAllowance.call(sim, c) > 0) return originals.behaveForage.call(sim, c)
      if (Math.abs(c.tx - c.x) < 0.4 && Math.abs(c.ty - c.y) < 0.4) {
        originals.pickWanderTarget.call(sim, c)
      }
      if (c.energy < ph.maxEnergy * 0.45) {
        c.behavior = BEHAVIOR_REST
        return 0
      }
      return originals.moveToward.call(sim, c, c.tx, c.ty, 0.4)
    }
  }

  if (mode === 'walk') {
    // Candidate (q): the same hunt, except a carcass in sight is weighed against the
    // quarry, and the animal goes to whichever is the closer meal.
    path.behaveHunt = (c: Creature): number => {
      const ph = c.phenotype
      if (ph.diet < 0.2) return originals.behaveForage.call(sim, c)
      const quarry = originals.pickQuarry.call(sim, c)
      if (quarry) {
        const dist = Math.hypot(quarry.x - c.x, quarry.y - c.y)
        if (dist < ph.speed + 0.6) {
          path.attack.call(sim, c, quarry)
          return 0
        }
        const best = pickCarrion(c)
        if (best >= 0) {
          const bx = best % world.width
          const by = Math.floor(best / world.width)
          const cDist = Math.hypot(by + 0.5 - c.y, bx + 0.5 - c.x)
          if (cDist < dist) {
            if (cDist < ph.speed + STRIKE) {
              if (eatCarrion(c, best)) {
                walkMeals += 1
                return 0
              }
            }
            c.tx = bx + 0.5
            c.ty = by + 0.5
            return originals.moveToward.call(sim, c, bx + 0.5, by + 0.5)
          }
        }
        c.tx = quarry.x
        c.ty = quarry.y
        return originals.moveToward.call(sim, c, quarry.x, quarry.y)
      }
      if (ph.diet < 0.7) return originals.behaveForage.call(sim, c)
      if (eatCarrion(c, Math.floor(c.y) * world.width + Math.floor(c.x))) {
        feetMeals += 1
        return 0
      }
      const best = pickCarrion(c)
      if (best >= 0) {
        const bx = best % world.width
        const by = Math.floor(best / world.width)
        c.tx = bx + 0.5
        c.ty = by + 0.5
        return originals.moveToward.call(sim, c, bx + 0.5, by + 0.5)
      }
      if (originals.juvenilePlantAllowance.call(sim, c) > 0) return originals.behaveForage.call(sim, c)
      if (Math.abs(c.tx - c.x) < 0.4 && Math.abs(c.ty - c.y) < 0.4) {
        originals.pickWanderTarget.call(sim, c)
      }
      if (c.energy < ph.maxEnergy * 0.45) {
        c.behavior = BEHAVIOR_REST
        return 0
      }
      return originals.moveToward.call(sim, c, c.tx, c.ty, 0.4)
    }
  }

  // The pool's own step, installed on the world's prototype: carrion sinks into litter at
  // the candidate's fixed share each tick before the tile's decomposition runs, and what
  // the pool cannot hold is buried. This is the step both candidate arms share, so the
  // only thing that differs between `feet` and `walk` is the feeding decision.
  const originalStepVegetation = worldPath.stepVegetation
  if (mode !== 'off') {
    worldPath.stepVegetation = (env: EnvState, flux: EnergyFlux): void => {
      for (let i = 0; i < carrion.length; i++) {
        const held = carrion[i]
        if (held <= 0) continue
        const sunk = held * CARRION_SINK
        carrion[i] = held - sunk
        carrionSunk += sunk
        carrionBurialFromSink += world.depositDetritus(i, sunk)
      }
      originalStepVegetation.call(world, env, flux)
    }
  }

  const rows: Row[] = []
  let bandPeak = 0
  let carnivorePeak = 0
  let poolPeak = 0
  let predationBefore = 0
  try {
    for (let window = 1; window <= WINDOWS; window++) {
      sim.run(CHUNK)

      let band = 0
      let carnivores = 0
      let population = 0
      let nearestSum = 0
      let nearestMax = 0
      let nearestCount = 0
      const carrionTiles: number[] = []
      for (let i = 0; i < carrion.length; i++) {
        if (carrion[i] > 0.01) carrionTiles.push(i)
      }
      const bandAnimals: Creature[] = []
      for (const c of sim.creatures) {
        if (!c.alive) continue
        population += 1
        if (!isCarnivore(c)) continue
        carnivores += 1
        if (isStrict(c)) {
          band += 1
          bandAnimals.push(c)
        }
      }
      // How far the animals the carrion rules feed are standing from the carrion the rules
      // put in the world. Measured for the strict band, which is the set the candidate is
      // for: the band count in `Row.band` is what §6D measures, and this is why it is empty.
      for (const c of bandAnimals) {
        let best = Infinity
        for (const t of carrionTiles) {
          const tx = (t % world.width) + 0.5
          const ty = Math.floor(t / world.width) + 0.5
          const d = Math.hypot(c.x - tx, c.y - ty)
          if (d < best) best = d
        }
        if (best === Infinity) continue
        nearestSum += best
        nearestCount += 1
        if (best > nearestMax) nearestMax = best
      }
      if (band > bandPeak) bandPeak = band
      if (carnivores > carnivorePeak) carnivorePeak = carnivores
      const carrionPool = totalCarrion()
      if (carrionPool > poolPeak) poolPeak = carrionPool
      const predation = sim.deathTotals().predation - predationBefore
      predationBefore += predation
      rows.push({
        tick: window * CHUNK,
        band,
        carnivores,
        carrion: carrionPool,
        nearestMean: nearestCount > 0 ? nearestSum / nearestCount : -1,
        nearestMax: nearestCount > 0 ? nearestMax : -1,
        population,
        predation,
        carrionEaten,
        carrionMeals,
        walkAsked: asked,
        walkChose: choseWalk,
      })
      if (population === 0) break
    }
  } finally {
    path.kill = originalKill
    worldPath.stepVegetation = originalStepVegetation
    if (mode !== 'off') {
      path.attack = originals.attack
      path.behaveHunt = originals.behaveHunt
    }
  }

  let bandStarved = 0
  let bandStarvedYoung = 0
  for (const [key, n] of bandDeaths) {
    if (key.startsWith('starvation')) {
      bandStarved += n
      if (key.endsWith('(before maturityAge)')) bandStarvedYoung += n
    }
  }

  return {
    seed,
    mode,
    rows,
    endRow: rows[rows.length - 1],
    bandPeak,
    carnivorePeak,
    poolPeak,
    fromKills,
    fromCorpses,
    carrionEaten,
    carrionMeals,
    carrionSunk,
    carrionBuried,
    asked,
    choseWalk,
    refusedNoRoom,
    refusedWalkCost,
    feetMeals,
    walkMeals,
    carrionBurialFromSink,
    bandDeaths,
    bandStarved,
    bandStarvedYoung,
    carnivoreCensus: sim.lastCensus ? sim.lastCensus.carnivores : 0,
    predation: predationBefore,
    starvation: sim.deathTotals().starvation,
    naturalDeaths: sim.totalDeaths() - predationBefore,
  }
}

const fmt = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : 'n/a')
const pad = (s: string, n: number): string => s.padStart(n)

const results = new Map<string, Record<Mode, RunResult>>()
for (const seed of SEEDS) {
  const byMode = {} as Record<Mode, RunResult>
  for (const mode of MODES) byMode[mode] = run(seed, mode)
  results.set(seed, byMode)
}

const baselineHeld: Record<string, boolean> = {}
for (const seed of SEEDS) {
  const off = results.get(seed)!.off
  const want = BASELINE[seed]
  baselineHeld[seed] =
    off.rows.length === WINDOWS &&
    off.endRow.band === want.band &&
    off.endRow.population === want.population &&
    off.predation === want.predation
}

for (const seed of SEEDS) {
  const { off, feet, walk } = results.get(seed)!
  console.log(`\n===== seed ${seed} =====`)
  console.log(
    `  off   strict band ${off.endRow.band}  carnivores ${off.carnivoreCensus} (the engine's own census category)` +
      `  population ${off.endRow.population}  predation ${off.predation}`,
  )
  for (const r of [feet, walk]) {
    console.log(
      `  ${LABEL[r.mode]}: strict band ${r.endRow.band} at the 3000-tick census (peak ${r.bandPeak} at some census)` +
        `  animals the carrion rule feeds ${r.endRow.carnivores} (peak ${r.carnivorePeak})`,
    )
    console.log(
      `      carrion in the world ${fmt(r.endRow.carrion)} (peak ${fmt(r.poolPeak)})  eaten ${fmt(r.carrionEaten)} in ${r.carrionMeals} meals` +
        `  from a kill ${fmt(r.fromKills)}  from a body that died of anything else ${fmt(r.fromCorpses)}`,
    )
    console.log(
      `      sunk into the litter at 3% a tick ${fmt(r.carrionSunk)}  too much for the pool ${fmt(r.carrionBuried)}` +
        `  eaten without walking ${r.feetMeals} meals  walked to a carcass ${r.walkMeals} meals`,
    )
    if (r.asked > 0) {
      console.log(
        `  walk rule asked ${r.asked} times: walked to a carcass ${r.choseWalk}` +
          `  refused no reserve ${r.refusedNoRoom}  refused the walk does not pay ${r.refusedWalkCost}`,
      )
    }
    console.log(
      `      nearest carrion to a band animal: mean ${fmt(r.endRow.nearestMean)} tiles, furthest ${pad(fmt(r.endRow.nearestMax), 6)}` +
        `  population ${r.endRow.population}  predation ${r.predation}  starvation deaths ${r.starvation}`,
    )
    const deaths = [...r.bandDeaths.entries()].sort((a, b) => b[1] - a[1])
    for (const [cause, n] of deaths) {
      console.log(`      band death ${pad(`${n}`, 4)}  ${cause}`)
    }
    console.log(
      `      band animals that starved ${r.bandStarved}, of which before maturity ${r.bandStarvedYoung}` +
      `  of all deaths in the run: starvation ${r.starvation}  predation ${r.predation}` +
      `  other causes ${r.naturalDeaths - r.starvation}`,
    )
  }

  const reproduced = baselineHeld[seed]
  console.log(
    `  baseline reproduction: ${off.rows.length} censuses, band ${pad(`${off.endRow.band}`, 3)}/${pad(`${BASELINE[seed].band}`, 3)}` +
      `  population ${pad(`${off.endRow.population}`, 5)}/${pad(`${BASELINE[seed].population}`, 5)}` +
      `  predation ${pad(`${off.predation}`, 6)}/${pad(`${BASELINE[seed].predation}`, 6)} -> ${reproduced ? 'EXACT' : 'FAILED'}`,
  )

  console.log(
    `  census windows. The off arm has no carrion to measure, so only the two candidate arms are tabulated:`,
  )
  console.log(
    `      tick   carrion in the world  eaten this window  carrion eaten total  strict band  nearest carrion (mean tiles)  walk asked  walk chosen`,
  )
  for (const r of [feet, walk]) {
    console.log(`    ${LABEL[r.mode]}`)
    r.rows.forEach((row, i) => {
      const prev = i > 0 ? r.rows[i - 1] : undefined
      console.log(
        `      ${pad(`${row.tick}`, 5)}` +
          `  ${pad(fmt(row.carrion), 20)}  ${pad(fmt(row.carrionEaten - (prev?.carrionEaten ?? 0)), 18)}` +
          `  ${pad(fmt(row.carrionEaten), 18)}  ${pad(`${row.band}`, 11)}` +
          `  ${pad(fmt(row.nearestMean), 25)}` +
          `  ${pad(`${row.walkAsked - (prev?.walkAsked ?? 0)}`, 11)}  ${pad(`${row.walkChose - (prev?.walkChose ?? 0)}`, 12)}`,
      )
    })
  }
}

console.log(`\n===== verdict at the 3000-tick census =====`)
const baselinesHeld = SEEDS.every((s) => baselineHeld[s])
for (const seed of SEEDS) {
  console.log(
    `  ${seed}: the off arm ${baselineHeld[seed] ? 'reproduced' : 'did NOT reproduce'} the recorded census` +
      `  band ${results.get(seed)!.off.endRow.band}/${BASELINE[seed].band}` +
      `  population ${results.get(seed)!.off.endRow.population}/${BASELINE[seed].population}` +
      `  predation ${results.get(seed)!.off.predation}/${BASELINE[seed].predation}`,
  )
}
if (!baselinesHeld) {
  console.log(`  the untouched engine did not reproduce the recorded run, so no candidate result means anything`)
}

const seedsHeld = (mode: Mode): string[] => SEEDS.filter((s) => results.get(s)![mode].endRow.band > 0)
const seedsAppeared = (mode: Mode): string[] => SEEDS.filter((s) => results.get(s)![mode].bandPeak > 0)

console.log(`  the pass bar (§6D): a strict carnivore lineage still present at the 3000-tick census on at least two seeds`)
for (const mode of ['feet', 'walk'] as Mode[]) {
  const held = seedsHeld(mode)
  console.log(
    `  ${LABEL[mode]}: lineage present at the last census on ${held.length} of 3 seeds` +
      ` (${held.length > 0 ? held.join(', ') : 'none'})` +
      `  lineage appeared at some census on ${seedsAppeared(mode).length} of 3 seeds` +
      `  -> ${held.length >= 2 ? 'PASSES' : 'does not pass'}`,
  )
}

const carrionMeals = (mode: Mode): number => SEEDS.reduce((n, s) => n + results.get(s)![mode].carrionMeals, 0)
console.log(
  `  carrion actually eaten across the three seeds: feet arm ${carrionMeals('feet')} meals` +
    `  walk arm ${carrionMeals('walk')} meals`,
)
