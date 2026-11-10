/**
 * Scratch diagnostic (not part of the test suite): candidate (m) — a strict
 * carnivore may take plants while it is below its own `maturityAge`, and never
 * again (PROGRESS.md §8 step 3m). The cohort audit showed what this candidate
 * is aimed at: a founding herd that survives and a strict-carnivore generation
 * that does not. So the measurement is the fate of that generation, and it has
 * to be measured against the rule the candidate replaces, on the same seed and
 * the same world.
 *
 * Each seed is run twice. The baseline arm is the committed engine with its own
 * `juvenilePlantAllowance` patched to return zero. Every branch the candidate
 * adds sits behind `allowance > 0`, so with that patch none of them is taken
 * and no extra random number is drawn: that arm is the engine exactly as
 * committed, and if it does not reproduce the recorded census then the two runs
 * are not one rule apart and nothing else printed here means anything.
 *
 *   npx vite-node tests/scratch-juvenile-plant-allowance.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'
import type { DeathCause } from '../src/sim/types'

const TICKS = 3000
const CHUNK = 250
const STRICT = 0.66
const SEEDS = ['evolab', 'evolab-2', 'evolab-3']

interface Row {
  tick: number
  band: number
  founding: number
  recruits: number
  recruitsAdult: number
  population: number
}

interface Intake {
  /** Plant energy taken by band members born in this world, by age class. */
  plantRecruitYoung: number
  plantRecruitAdult: number
  /** Meat energy taken by the same animals, for the same period. */
  meatRecruitYoung: number
}

interface RunResult {
  seed: string
  allowanceOn: boolean
  rows: Row[]
  peakAdults: number
  deaths: Map<string, number>
  intake: Intake
  predation: number
  spread: DietSpread
  adultSpread: DietSpread
}

/**
 * Inherited diets of the band, bucketed. This is the question the concession
 * has to answer: a bridge that young carnivores cross and then leave behind
 * leaves the band's diet where it was, while a concession that simply makes
 * plants available to anything above the boundary pulls the whole band onto the
 * boundary and quietly deletes the carnivore niche.
 */
interface DietSpread {
  count: number
  mean: number
  /** diet in [0.66,0.70), [0.70,0.80), [0.80,0.90), [0.90,1.00] */
  buckets: number[]
}

function dietSpread(creatures: Creature[], onlyAdults: boolean): DietSpread {
  const out: DietSpread = { buckets: [0, 0, 0, 0], mean: 0, count: 0 }
  let total = 0
  for (const c of creatures) {
    if (!c.alive) continue
    if (c.genome[TRAIT_INDEX.diet] <= STRICT) continue
    if (onlyAdults && c.age < c.phenotype.maturityAge) continue
    const d = c.genome[TRAIT_INDEX.diet]
    const i = d < 0.7 ? 0 : d < 0.8 ? 1 : d < 0.9 ? 2 : 3
    out.buckets[i] += 1
    out.count += 1
    total += d
  }
  out.mean = out.count ? total / out.count : 0
  return out
}

function formatSpread(s: DietSpread): string {
  if (!s.count) return 'no band members'
  return (
    `n=${s.count} mean diet ${s.mean.toFixed(3)} ` +
    `[0.66-0.70 ${s.buckets[0]}] [0.70-0.80 ${s.buckets[1]}] ` +
    `[0.80-0.90 ${s.buckets[2]}] [0.90+ ${s.buckets[3]}]`
  )
}

function run(seed: string, allowanceOn: boolean): RunResult {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  const engine = sim as unknown as {
    juvenilePlantAllowance: (c: Creature) => number
    kill: (c: Creature, cause: DeathCause) => void
    behaveForage: (c: Creature) => number
    attack: (c: Creature, prey: Creature) => void
  }

  // The candidate switched off: the engine's own method, patched on the
  // instance, so the decision chain, the search-with-no-quarry path and the
  // forage path all read zero. Every branch the candidate adds is behind
  // `allowance > 0`, so none of them runs and no extra random number is drawn:
  // this arm is the engine as committed.
  if (!allowanceOn) engine.juvenilePlantAllowance = () => 0

  const founded = new Set<number>()
  for (const c of sim.creatures) founded.add(c.id)

  const isStrict = (c: Creature): boolean => c.genome[TRAIT_INDEX.diet] > STRICT
  const isYoung = (c: Creature): boolean => c.age < c.phenotype.maturityAge

  const intake: Intake = { meatRecruitYoung: 0, plantRecruitAdult: 0, plantRecruitYoung: 0 }
  const deaths = new Map<string, number>()

  // Deaths of strict-band animals, attributed at the call that makes them.
  // Whether the dead animal had reached its own maturityAge is the exact
  // question this candidate is being asked.
  const killInner = engine.kill.bind(sim)
  engine.kill = (c: Creature, cause: DeathCause) => {
    if (isStrict(c)) {
      const key = `${founded.has(c.id) ? 'founding' : 'recruit'} ${isYoung(c) ? 'young' : 'adult'} ${cause}`
      deaths.set(key, (deaths.get(key) ?? 0) + 1)
    }
    killInner(c, cause)
  }

  // Energy attribution. Feeding happens inside these two calls and the energy
  // bill for the tick is applied after them, so the difference across a call is
  // what that animal got out of that meal. A concession that is a fallback
  // shows up as a small part of a juvenile's intake; a concession that is really
  // herbivory shows up as most of it.
  const forageInner = engine.behaveForage.bind(sim)
  engine.behaveForage = (c: Creature) => {
    const before = c.energy
    const moved = forageInner(c)
    if (isStrict(c) && !founded.has(c.id)) {
      const gained = c.energy - before
      if (isYoung(c)) intake.plantRecruitYoung += gained
      else intake.plantRecruitAdult += gained
    }
    return moved
  }

  const attackInner = engine.attack.bind(sim)
  engine.attack = (c: Creature, prey: Creature) => {
    const before = c.energy
    attackInner(c, prey)
    if (isStrict(c) && !founded.has(c.id) && isYoung(c)) {
      intake.meatRecruitYoung += c.energy - before
    }
  }

  const census = (): { adults: number; recruits: number; founding: number; band: number; population: number } => {
    let adults = 0
    let recruits = 0
    let band = 0
    let founding = 0
    let population = 0
    for (const c of sim.creatures) {
      if (!c.alive) continue
      population += 1
      if (!isStrict(c)) continue
      band += 1
      if (founded.has(c.id)) {
        founding += 1
      } else {
        recruits += 1
        if (!isYoung(c)) adults += 1
      }
    }
    return { band, recruits, adults, founding, population }
  }

  const rows: Row[] = []
  let peakAdults = 0
  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    const c = census()
    if (c.adults > peakAdults) peakAdults = c.adults
    rows.push({
      tick: window * CHUNK,
      band: c.band,
      founding: c.founding,
      recruits: c.recruits,
      recruitsAdult: c.adults,
      population: c.population,
    })
  }

  const label = allowanceOn ? 'juvenile plant allowance ON' : 'allowance patched to zero = engine as committed'
  console.log(`\n--- seed ${seed} — ${label} ---`)
  for (const r of rows) {
    console.log(
      `  tick ${String(r.tick).padStart(4)}  strict=${String(r.band).padStart(3)}` +
        ` founding=${String(r.founding).padStart(3)} recruits=${String(r.recruits).padStart(3)}` +
        ` recruitsAdult=${String(r.recruitsAdult).padStart(3)}  population=${String(r.population).padStart(5)}`,
    )
  }
  console.log(
    `  strict-band recruits' energy: plants ${intake.plantRecruitYoung.toFixed(1)} E (young),` +
      ` ${intake.plantRecruitAdult.toFixed(1)} E (adult); meat ${intake.meatRecruitYoung.toFixed(1)} E (young)`,
  )
  // The decisive measurement for this candidate. A bridge that works leaves the
  // band's inherited diets where they were: the animals still alive at the end
  // are carnivores, because the concession never reaches an adult. If the band
  // that survives is all animals sitting just above 0.66, the concession has
  // replaced selection on the diet gene with a free pass through the boundary,
  // and the world is grazed by animals carrying a meat diet they never express.
  const allAges = dietSpread(sim.creatures, false)
  const mature = dietSpread(sim.creatures, true)
  console.log(`  inherited diets still in the band, all ages: ${formatSpread(allAges)}`)
  console.log(`  ... still in animals past maturityAge: ${formatSpread(mature)}`)
  console.log(`  strict-band deaths, attributed:`)
  for (const [key, n] of [...deaths].sort()) console.log(`    ${key}: ${n}`)
  console.log(`  global death tally: ${JSON.stringify(sim.deathTotals())}`)

  return {
    seed,
    allowanceOn,
    rows,
    peakAdults,
    deaths,
    intake,
    spread: allAges,
    adultSpread: mature,
    predation: sim.deathTotals().predation,
  }
}

const table: { off: RunResult; on: RunResult }[] = []
for (const seed of SEEDS) {
  const off = run(seed, false)
  const on = run(seed, true)
  table.push({ off, on })
}

console.log('\n=== strict band (inherited diet > 0.66) at the 3000-tick census ===')
for (const { off, on } of table) {
  const a = off.rows[off.rows.length - 1]
  const b = on.rows[on.rows.length - 1]
  console.log(
    `  ${on.seed}: allowance off strict=${a.band} recruits=${a.recruits} adults=${a.recruitsAdult} population=${a.population}` +
      `  |  allowance ON strict=${b.band} recruits=${b.recruits} adults=${b.recruitsAdult} peak adults=${on.peakAdults}` +
      ` population=${b.population}`,
  )
}
