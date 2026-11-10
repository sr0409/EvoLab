/**
 * Carrion feeding: candidate (p) and the question of where the carrion comes from.
 * (PROGRESS.md §6D, §8)
 *
 * Candidate (p), exactly as it was implemented and measured in the engine: the part of a
 * kill a predator could not absorb stays on the ground as carrion instead of mixing into
 * the litter, and a strict carnivore (diet >= 0.7) with no legal quarry in sight eats the
 * leftovers at its feet before it starts walking. A carrion pool fed that way is fed by
 * predators, so the second arm asks the obvious next question: does it help any more when
 * the pool also receives the animals that died of old age, disease, thermal stress or
 * starvation — the corpses nobody ate, which are what carrion mostly is?
 *
 * Three arms, all reconstructed on the instance at runtime so the committed engine is never
 * modified (the same shape `scratch-pursuit-flight-gate.ts` uses):
 *   off   the committed engine, untouched; it must reproduce the recorded census
 *         (band 0 / 0 / 20, populations 3197 / 3191 / 2346, predation 601 / 151 / 16782 at
 *         the 3000-tick census). If it does not, the other two arms are not one rule apart
 *         and nothing printed here means anything;
 *   kill  candidate (p): the carrion pool is fed only by the leftover of a kill;
 *   all   the variant: fed by kill leftovers *and* by the whole body of any animal that
 *         died of a cause other than predation.
 * Everything else — the world, the founders, the chase gate, the juvenile allowance, every
 * other rule — is identical in all three arms. The carrion pool, its 30-unit per-tile
 * ceiling and its 3%/tick sinking into the litter pool are the candidate's own numbers;
 * the sink runs where the candidate had it, inside the tick's vegetation step and before
 * that tick's decomposition, so carrion that sinks is decomposable in the same tick.
 * Nothing here draws a random number, so the herd's decisions are the engine's own.
 *
 *   npx vite-node tests/scratch-carrion-scavenge.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'
import { BEHAVIOR_REST } from '../src/sim/types'
import type { DeathCause } from '../src/sim/types'
import type { EnvState, EnergyFlux } from '../src/sim/world'

const TICKS = 3000
const CHUNK = 250
const WINDOWS = TICKS / CHUNK
const STRICT = 0.66
const SEEDS = ['evolab', 'evolab-2', 'evolab-3']

/** The candidate's own carrion constants, kept as it ran them. */
const CARRION_MAX = 30
const CARRION_SINK_RATE = 0.03

type Mode = 'off' | 'kill' | 'all'
const MODES: Mode[] = ['off', 'kill', 'all']

const LABEL: Record<Mode, string> = {
  off: 'off (committed engine)',
  kill: 'carrion from kills only — candidate (p)',
  all: 'carrion from kills and from natural-cause corpses',
}

/** The committed engine's census at the 3000-tick census, as §6D records it. */
const BASELINE: Record<string, { band: number; population: number; predation: number }> = {
  evolab: { band: 0, population: 3197, predation: 601 },
  'evolab-2': { band: 0, population: 3191, predation: 151 },
  'evolab-3': { band: 20, population: 2346, predation: 16782 },
}

/** The private engine methods the carrion rule has to sit inside. */
interface EnginePath {
  attack: (c: Creature, prey: Creature) => void
  behaveForage: (c: Creature) => number
  behaveHunt: (c: Creature) => number
  juvenilePlantAllowance: (c: Creature) => number
  kill: (c: Creature, cause: DeathCause) => void
  deposit: (tile: number, amount: number) => void
  moveToward: (c: Creature, tx: number, ty: number, speedScale?: number) => number
  pickQuarry: (c: Creature) => Creature | undefined
  pickWanderTarget: (c: Creature) => void
}

interface EngineInternals {
  deathsSinceCensus: number
}

const dietOf = (c: Creature): number => c.genome[TRAIT_INDEX.diet]
const isStrict = (c: Creature): boolean => dietOf(c) > STRICT
const isYoung = (c: Creature): boolean => c.age < c.phenotype.maturityAge

interface Row {
  tick: number
  band: number
  carrion: number
  population: number
  predation: number
}

interface RunResult {
  seed: string
  mode: Mode
  rows: Row[]
  endRow: Row
  bandPeak: number
  /** Carrion the pool actually took in, by source. */
  fromKills: number
  fromCorpses: number
  carrionEaten: number
  carrionMeals: number
  carrionSunk: number
  carrionBuried: number
  peakCarrion: number
  bandDeaths: Map<string, number>
  bandStarved: number
  bandStarvedYoung: number
  predation: number
  starvation: number
  naturalDeaths: number
  baselineOk: boolean
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

  const putCarrion = (tile: number, amount: number, source: 'kill' | 'corpse'): void => {
    if (amount <= 0) return
    const held = carrion[tile]
    const room = CARRION_MAX - held
    if (amount <= room) {
      carrion[tile] = held + amount
    } else {
      carrion[tile] = CARRION_MAX
      const overflow = amount - room
      carrionBuried += overflow
    }
    const taken = amount < room ? amount : room
    if (source === 'kill') fromKills += taken
    else fromCorpses += taken
  }

  const takeCarrion = (tile: number, amount: number): number => {
    if (amount <= 0) return 0
    const held = carrion[tile]
    if (held <= 0) return 0
    const eaten = held < amount ? held : amount
    carrion[tile] = held - eaten
    return eaten
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
    kill: path.kill,
    deposit: path.deposit,
    moveToward: path.moveToward,
    pickQuarry: path.pickQuarry,
    pickWanderTarget: path.pickWanderTarget,
  }
  const worldPath = Object.getPrototypeOf(world) as {
    stepVegetation: (env: EnvState, flux: EnergyFlux) => void
  }
  /**
   * Candidate (p)'s scavenge rule: a strict carnivore eats the carrion under its own feet,
   * at its own bite size, and the gut pays the same rate it pays for any other animal food.
   * What the gut cannot absorb goes back onto the tile as litter.
   */
  const scavenge = (c: Creature): boolean => {
    const ph = c.phenotype
    const room = ph.maxEnergy - c.energy
    if (room <= 0) return false
    const tile = Math.floor(c.y) * world.width + Math.floor(c.x)
    const bite = Math.min(ph.bitePrey, room)
    const eaten = takeCarrion(tile, bite)
    if (eaten <= 0) return false
    const absorbed = Math.min(room, eaten * (0.45 + 0.45 * ph.digest))
    c.energy += absorbed
    if (eaten - absorbed > 0) originals.deposit.call(sim, tile, eaten - absorbed)
    carrionEaten += eaten
    carrionMeals += 1
    return true
  }

  if (mode !== 'off') {
    // The committed `attack`, with the one difference the candidate made: what the hunter's
    // own gut could not hold stays at the place the quarry died, as carrion.
    path.attack = (c: Creature, prey: Creature): void => {
      const damage = (0.1 + 0.5 * c.phenotype.aggression) * (0.4 + 0.6 * c.phenotype.speed)
      prey.health -= damage
      if (prey.health > 0) return
      const transferable = prey.energy
      const room = c.phenotype.maxEnergy - c.energy
      const absorbed = Math.min(room, transferable * (0.45 + 0.45 * c.phenotype.digest))
      c.energy += absorbed
      const leftover = transferable - absorbed
      const tile = Math.floor(prey.y) * world.width + Math.floor(prey.x)
      if (leftover > 0) putCarrion(tile, leftover, 'kill')
      prey.energy = 0
      c.kills += 1
      originals.kill.call(sim, prey, 'predation')
    }

    // The committed `behaveHunt`, verbatim, plus the candidate's branch: a strict
    // carnivore with nothing legal in sight eats what a kill left at its feet before it
    // starts walking, and it does that before the juvenile plant allowance is considered.
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
      if (scavenge(c)) return 0
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

  /** The committed `kill`, with the variant's one difference: an uneaten body becomes carrion. */
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

  // Every strict death is attributed, as the other band census does: a band animal that
  // starves before its own maturityAge is the death this rule claims to be able to close.
  const bandDeaths = new Map<string, number>()
  const originalKill = path.kill
  path.kill = (c: Creature, cause: DeathCause): void => {
    if (isStrict(c)) {
      const key = `${cause}${isYoung(c) ? ' (before maturityAge)' : ''}`
      bandDeaths.set(key, (bandDeaths.get(key) ?? 0) + 1)
    }
    if (mode === 'all') killToCarrion(c, cause)
    else originalKill.call(sim, c, cause)
  }

  // The carrion pool sinks into the litter pool at a fixed share per tick, which is where
  // the candidate had it: inside the tick's vegetation step, before that tile's
  // decomposition, so what sinks is decomposable in the same tick. Sinking is a transfer,
  // not a respiration: whatever the soil cannot hold is buried.
  const originalStepVegetation = worldPath.stepVegetation
  if (mode !== 'off') {
    worldPath.stepVegetation = (env: EnvState, flux: EnergyFlux): void => {
      let sunkBurial = 0
      for (let i = 0; i < carrion.length; i++) {
        const held = carrion[i]
        if (held <= 0) continue
        const sunk = held * CARRION_SINK_RATE
        carrion[i] = held - sunk
        carrionSunk += sunk
        sunkBurial += world.depositDetritus(i, sunk)
      }
      originalStepVegetation.call(world, env, flux)
      flux.buried += sunkBurial
    }
  }

  const rows: Row[] = []
  let bandPeak = 0
  let peakCarrion = 0
  let predationBefore = 0
  try {
    for (let window = 1; window <= WINDOWS; window++) {
      sim.run(CHUNK)
      let band = 0
      let population = 0
      for (const c of sim.creatures) {
        if (!c.alive) continue
        population += 1
        if (isStrict(c)) band += 1
      }
      if (band > bandPeak) bandPeak = band
      const carrionPool = totalCarrion()
      if (carrionPool > peakCarrion) peakCarrion = carrionPool
      const predation = sim.deathTotals().predation - predationBefore
      predationBefore += predation
      rows.push({ tick: window * CHUNK, band, carrion: carrionPool, population, predation })
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

  const endRow = rows[rows.length - 1]
  const expected = BASELINE[seed]
  const baselineOk =
    rows.length === WINDOWS &&
    endRow.band === expected.band &&
    endRow.population === expected.population &&
    rows.reduce((s, r) => s + r.predation, 0) === expected.predation

  return {
    seed,
    mode,
    rows,
    endRow,
    bandPeak,
    fromKills,
    fromCorpses,
    carrionEaten,
    carrionMeals,
    carrionSunk,
    carrionBuried,
    peakCarrion,
    bandDeaths,
    bandStarved,
    bandStarvedYoung,
    predation: predationBefore,
    starvation: sim.deathTotals().starvation,
    naturalDeaths: sim.totalDeaths() - predationBefore,
    baselineOk,
  }
}

function fmt(n: number, digits = 1): string {
  return n.toFixed(digits)
}

const results = new Map<string, Map<Mode, RunResult>>()
for (const seed of SEEDS) {
  const byMode = new Map<Mode, RunResult>()
  for (const mode of MODES) byMode.set(mode, run(seed, mode))
  results.set(seed, byMode)
}

for (const seed of SEEDS) {
  const byMode = results.get(seed)!
  const off = byMode.get('off')!
  const kill = byMode.get('kill')!
  const all = byMode.get('all')!
  console.log(`\n================ seed ${seed} ================`)
  console.log(
    `  off  (committed engine): band ${off.endRow.band} peak band ${off.bandPeak} population ${off.endRow.population}` +
      ` predation ${off.predation} starvation ${off.starvation}` +
      `  baseline reproduction: ${off.rows.length === WINDOWS && off.endRow.band === BASELINE[seed].band && off.endRow.population === BASELINE[seed].population && off.predation === BASELINE[seed].predation ? 'EXACT' : 'FAILED'}`,
  )
  for (const r of [kill, all]) {
    console.log(
      `  ${r.mode}: band ${r.endRow.band} peak band ${r.bandPeak} population ${r.endRow.population}` +
        ` predation ${r.predation} starvation ${r.starvation} deaths not from predation ${r.naturalDeaths}`,
    )
    console.log(
      `      carrion: pool took in ${fmt(r.fromKills)}E from kill leftovers + ${fmt(r.fromCorpses)}E from corpses` +
        `  peak pool ${fmt(r.peakCarrion)}E  eaten ${fmt(r.carrionEaten)}E in ${r.carrionMeals} meals` +
        `  sank to litter ${fmt(r.carrionSunk)}E  buried ${fmt(r.carrionBuried)}E`,
    )
    if (r.bandDeaths.size) {
      console.log(`      strict-band deaths: ${[...r.bandDeaths.entries()].sort().map(([k, v]) => `${k} ${v}`).join(', ')}`)
    }
    console.log(`      band starved: total ${r.bandStarved}, before maturityAge ${r.bandStarvedYoung}`)
  }
  console.log(`  carrion pool over the run (kill-only arm / kills-and-corpses arm):`)
  for (let i = 0; i < kill.rows.length; i++) {
    const a = kill.rows[i]
    const b = all.rows[i]
    console.log(
      `    tick ${String(a.tick).padStart(4)}  band ${String(a.band).padStart(3)}/${String(b.band).padStart(3)}` +
        `  carrion ${fmt(a.carrion).padStart(8)}/${fmt(b.carrion).padStart(8)}` +
        `  population ${String(a.population).padStart(5)}/${String(b.population).padStart(5)}` +
        `  predation this window ${String(a.predation).padStart(5)}/${String(b.predation).padStart(5)}`,
    )
  }
}

console.log(`\n================ verdict at the 3000-tick census ================`)
let baselineExact = true
const passes: Record<Mode, number> = { off: 0, kill: 0, all: 0 }
for (const seed of SEEDS) {
  const byMode = results.get(seed)!
  const off = byMode.get('off')!
  baselineExact = baselineExact && off.endRow.band === BASELINE[seed].band && off.endRow.population === BASELINE[seed].population && off.predation === BASELINE[seed].predation && off.rows.length === WINDOWS
  for (const mode of MODES) if (byMode.get(mode)!.endRow.band > 0) passes[mode] += 1
  console.log(
    `  ${seed}: off band ${off.endRow.band} (recorded ${BASELINE[seed].band}) population ${off.endRow.population} (recorded ${BASELINE[seed].population}) predation ${off.predation} (recorded ${BASELINE[seed].predation})`,
  )
  for (const mode of MODES) {
    const r = byMode.get(mode)!
    console.log(
      `    ${LABEL[mode]}: band ${r.endRow.band}  peak band ${r.bandPeak}  predation ${r.predation}` +
        `  carrion eaten ${fmt(r.carrionEaten)}E`,
    )
  }
}
console.log(`\nbaseline arm reproduces the committed engine: ${baselineExact ? 'exactly, on all three seeds' : 'NO — none of the comparisons below mean anything'}`)
for (const mode of MODES) {
  console.log(`  ${LABEL[mode]}: strict band alive at the 3000-tick census on ${passes[mode]} of 3 seeds`)
}
console.log(`pass bar (the standing §6D bar): strict band alive at the 3000-tick census on at least 2 of 3 seeds`)
console.log(`candidate (p) (kill leftovers only): ${passes.kill >= 2 ? 'PASSES' : 'does not pass'}`)
console.log(`carrion from natural-cause corpses as well: ${passes.all >= 2 ? 'PASSES' : 'does not pass'}`)
