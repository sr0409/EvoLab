/**
 * Scratch diagnostic (not part of the test suite): candidate (n) — seed the
 * strict carnivore founders at age 0 instead of at their maturity age
 * (PROGRESS.md §6D, §8).
 *
 * The (m) measurement closed half of §6B and named the rest. The juvenile plant
 * concession works: on `evolab-3` a strict band holds animals through the whole
 * run and its recruits stay strict, all of them carrying inherited diets at
 * 0.90 and above. What the rule never got on `evolab` and `evolab-2` is a
 * subject to act on. The reason is upstream of the diet rules: `spawnFounder`
 * stamps every founding carnivore with `c.age = phenotype.maturityAge`, so a
 * founding animal is outside its own concession on the tick it appears, carries
 * the adult running cost from the first tick, and dies inside the first windows
 * — before a single strict juvenile exists for the concession to cover. The
 * candidate is that one number: the same animals, the same genomes, the same
 * `maxEnergy * 0.75` reserve, written at age 0 instead of at maturity age, so
 * the establishment window falls inside the rule the engine already has. The
 * engine's own `canBreed` gate (`age >= maturityAge`) is untouched, so the
 * candidate pays for the protection with a delay: the cohort can only breed
 * once it matures, roughly 140 ticks in. That trade is what this run measures.
 *
 * The candidate is applied to the finished Simulation, after world generation
 * and before the first tick, and only to founders whose inherited diet is above
 * the carnivore boundary. The producer founders are left exactly as committed —
 * they are the herd the hunters feed on, and changing them would confound the
 * result. The baseline arm applies no patch at all, so it is the committed
 * engine verbatim; if its numbers do not reproduce the recorded census of the
 * engine as committed — band 0 / 0 / 20 at the 3000-tick census, populations
 * 3197 / 3191 / 2346, predation 601 / 151 / 16782 (the post-(m) engine; the
 * pre-(m) census, band 0 / 0 / 11, is not produced by this tree any more) —
 * then the two arms are not one assignment apart and nothing
 * printed here means anything. The patch draws no random number, so the arms
 * are the same world apart from `age`.
 *
 * The measurement was run, and its result is in §6D candidate (n): it holds a
 * band at the 3000-tick census on one seed of three, so it is rejected; the
 * engine is unchanged and this file is kept as the evidence.
 *
 * Every answer is read from records the engine already keeps: each birth is
 * taken from the call that makes the animal, together with the inherited diet
 * each parent carried at that moment; each death from the engine's `kill`,
 * logged against the animal's own maturityAge; and the inherited diets carried
 * at the end are bucketed, because a band that survives only by drifting under
 * 0.66 has not produced a carnivore niche. The wrappers observe, they do not
 * intervene: neither arm consumes a random number the other does not.
 *
 *   npx vite-node tests/scratch-subadult-founders.ts
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

/**
 * The census of the engine as committed (4c9a61e: candidate (m)'s
 * juvenilePlantAllowance is now IN the engine). The pre-(m) census — band
 * 0 / 0 / 11, predation 338 / 161 / 6837 — is recorded in PROGRESS.md §6D,
 * but no run from this tree produces it any more. This probe's baseline arm
 * must reproduce these values exactly, or the two arms are not one stamping
 * apart and the comparison below means nothing.
 */
const RECORDED_BASELINE: Record<string, { band: number; population: number; predation: number }> = {
  evolab: { band: 0, population: 3197, predation: 601 },
  'evolab-2': { band: 0, population: 3191, predation: 151 },
  'evolab-3': { band: 20, population: 2346, predation: 16782 },
}

const dietOf = (c: { genome: Float32Array }): number => c.genome[TRAIT_INDEX.diet]
const isStrict = (c: { genome: Float32Array }): boolean => dietOf(c) > STRICT
const isYoung = (c: Creature): boolean => c.age < c.phenotype.maturityAge

interface Row {
  tick: number
  band: number
  founding: number
  recruits: number
  recruitsAdult: number
  population: number
}

/** A birth, taken from the call that makes it, with what each parent carried. */
interface BirthRecord {
  birthTick: number
  diet: number
  parents: 'two strict parents' | 'one strict parent' | 'no strict parent'
}

/** What became of one founding carnivore, measured against its own maturity age. */
interface FounderDeath {
  id: number
  seededAge: number
  maturityAge: number
  deathTick: number
  ageAtDeath: number
  cause: DeathCause
}

/**
 * Inherited diets carried by the band at a census. A band that survives only
 * because its members quietly moved under the boundary is not a carnivore
 * niche, so the shape of what is carried at the end belongs to the verdict.
 */
interface DietSpread {
  count: number
  mean: number
  /** Inherited diet, bucketed: [0.66,0.70) [0.70,0.80) [0.80,0.90) [0.90,1.00]. */
  buckets: number[]
}

function dietSpread(creatures: readonly Creature[], adultsOnly: boolean): DietSpread {
  const out: DietSpread = { count: 0, mean: 0, buckets: [0, 0, 0, 0] }
  let total = 0
  for (const c of creatures) {
    if (!c.alive) continue
    const d = dietOf(c)
    if (d <= STRICT) continue
    if (adultsOnly && isYoung(c)) continue
    const i = d < 0.7 ? 0 : d < 0.8 ? 1 : d < 0.9 ? 2 : 3
    out.buckets[i] += 1
    out.count += 1
    total += d
  }
  out.mean = out.count ? total / out.count : 0
  return out
}

function formatSpread(s: DietSpread): string {
  if (!s.count) return 'no band members at this census'
  return (
    `n=${s.count} mean ${s.mean.toFixed(3)} ` +
    `[0.66-0.70 ${s.buckets[0]}] [0.70-0.80 ${s.buckets[1]}] ` +
    `[0.80-0.90 ${s.buckets[2]}] [0.90+ ${s.buckets[3]}]`
  )
}

function describeBirths(births: BirthRecord[]): string {
  if (!births.length) return 'no strict offspring in 3000 ticks'
  const first = Math.min(...births.map((b) => b.birthTick))
  const byParents = new Map<string, number>()
  for (const b of births) byParents.set(b.parents, (byParents.get(b.parents) ?? 0) + 1)
  const breakdown = [...byParents.entries()].sort().map(([k, n]) => `${k}: ${n}`).join(', ')
  return `${births.length} strict births, first at tick ${first} (${breakdown})`
}

interface RunResult {
  seed: string
  seedYoung: boolean
  foundingCount: number
  rows: Row[]
  peakBand: number
  peakAdults: number
  births: BirthRecord[]
  reproducedFounders: Set<number>
  founderDeaths: FounderDeath[]
  deaths: Map<string, number>
  endRow: Row
  spreadAll: DietSpread
  spreadAdults: DietSpread
  totals: Record<string, number>
}

function run(seed: string, seedYoung: boolean): RunResult {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  // The candidate is this loop and nothing else: the strict founders as world
  // generation made them, written at age 0 instead of at maturity age. The
  // baseline arm applies nothing, so it is the committed engine as committed.
  const foundingStrict = new Set<number>()
  const seededAge = new Map<number, number>()
  for (const c of sim.creatures) {
    if (!c.alive || !isStrict(c)) continue
    foundingStrict.add(c.id)
    seededAge.set(c.id, c.age)
    if (seedYoung) c.age = 0
  }

  // Every animal the simulation has ever made, so a death can be attributed to
  // the animal it was and a birth to what its parents actually carried.
  const byId = new Map<number, number>()
  for (const c of sim.creatures) byId.set(c.id, dietOf(c))
  const parentDiet = (id: number | undefined): number => {
    if (id === undefined || id < 0) return Number.NaN
    const d = byId.get(id)
    return d === undefined ? Number.NaN : d
  }

  const engine = sim as unknown as {
    makeCreature: (
      genome: Float32Array,
      phenotype: unknown,
      speciesId: number,
      tile: number,
      birthTick: number,
      parentA?: number,
      parentB?: number,
      mate?: number,
    ) => Creature
    kill: (c: Creature, cause: DeathCause) => void
  }

  // Observe every birth at the call that makes the animal. The engine passes
  // the parent ids right there, so a birth is classified by what its parents
  // carried at the moment it was conceived. Founders came from the constructor
  // and are not seen here; they are already in byId.
  const births: BirthRecord[] = []
  const reproduced = new Set<number>()
  const makeInner = engine.makeCreature.bind(sim)
  engine.makeCreature = (genome, phenotype, speciesId, tile, birthTick, parentA = -1, parentB = -1, mate = -1) => {
    const c = makeInner(genome, phenotype, speciesId, tile, birthTick, parentA, parentB, mate)
    byId.set(c.id, dietOf(c))
    // The engine's Genome is the Float32Array itself; diet is slot 4 of it.
    const d = genome[TRAIT_INDEX.diet]
    if (d > STRICT) {
      const pa = parentDiet(parentA) > STRICT
      const pb = parentDiet(parentB) > STRICT
      births.push({
        birthTick,
        diet: d,
        parents: pa && pb ? 'two strict parents' : pa || pb ? 'one strict parent' : 'no strict parent',
      })
      if (foundingStrict.has(parentA) || foundingStrict.has(parentB)) {
        if (parentA !== undefined && parentA >= 0) reproduced.add(parentA)
        if (parentB !== undefined && parentB >= 0) reproduced.add(parentB)
      }
    }
    return c
  }

  const founderDeaths: FounderDeath[] = []
  const deaths = new Map<string, number>()
  const killInner = engine.kill.bind(sim)
  engine.kill = (c: Creature, cause: DeathCause) => {
    if (isStrict(c)) {
      const group = foundingStrict.has(c.id) ? 'founding' : 'recruit'
      const stage = isYoung(c) ? 'juvenile' : 'adult'
      const key = `${group} ${stage} ${cause}`
      deaths.set(key, (deaths.get(key) ?? 0) + 1)
      if (foundingStrict.has(c.id)) {
        founderDeaths.push({
          id: c.id,
          seededAge: seededAge.get(c.id) ?? c.age,
          maturityAge: c.phenotype.maturityAge,
          deathTick: sim.tick,
          ageAtDeath: c.age,
          cause,
        })
      }
    }
    killInner(c, cause)
  }

  const census = (): { band: number; founding: number; recruits: number; recruitsAdult: number; population: number } => {
    let band = 0
    let founding = 0
    let recruits = 0
    let recruitsAdult = 0
    let population = 0
    for (const c of sim.creatures) {
      if (!c.alive) continue
      population += 1
      if (!isStrict(c)) continue
      band += 1
      if (foundingStrict.has(c.id)) {
        founding += 1
      } else {
        recruits += 1
        if (!isYoung(c)) recruitsAdult += 1
      }
    }
    return { band, founding, recruits, recruitsAdult, population }
  }

  const rows: Row[] = []
  let peakBand = 0
  let peakAdults = 0
  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    const c = census()
    if (c.band > peakBand) peakBand = c.band
    if (c.recruitsAdult > peakAdults) peakAdults = c.recruitsAdult
    rows.push({
      tick: window * CHUNK,
      band: c.band,
      founding: c.founding,
      recruits: c.recruits,
      recruitsAdult: c.recruitsAdult,
      population: c.population,
    })
  }

  const label = seedYoung
    ? 'candidate: founding carnivores stamped age 0'
    : 'baseline: founders at maturityAge (engine as committed)'
  console.log(`\n--- seed ${seed} — ${label} ---`)
  for (const r of rows) {
    console.log(
      `  tick ${String(r.tick).padStart(4)}  strict=${String(r.band).padStart(3)}` +
        ` founding=${String(r.founding).padStart(3)} recruits=${String(r.recruits).padStart(3)}` +
        ` recruitsAdult=${String(r.recruitsAdult).padStart(3)}  population=${r.population}`,
    )
  }
  console.log(`  strict founders at world generation: ${foundingStrict.size}`)
  console.log(`  strict offspring: ${describeBirths(births)}`)
  console.log(`  founding animals that sired a strict birth: ${reproduced.size}`)
  const survived = rows[rows.length - 1].founding
  console.log(`  founding cohort: ${foundingStrict.size} seeded, ${founderDeaths.length} died, ${survived} alive at tick ${TICKS}`)
  for (const f of founderDeaths) {
    console.log(
      `    founder ${f.id}: seeded age ${f.seededAge}, maturityAge ${f.maturityAge}, ` +
        `died at age ${f.ageAtDeath} at tick ${f.deathTick} (${f.cause})` +
        (f.ageAtDeath >= f.maturityAge ? ', lived past maturity' : ', died before maturity') +
        (reproduced.has(f.id) ? ', reproduced' : ', never bred'),
    )
  }
  console.log(`  strict-band deaths by origin, stage and cause:`)
  for (const [key, n] of [...deaths.entries()].sort()) console.log(`    ${key}: ${n}`)
  console.log(`  inherited diets carried at the end, all ages: ${formatSpread(dietSpread(sim.creatures, false))}`)
  console.log(`  ... carried past maturityAge: ${formatSpread(dietSpread(sim.creatures, true))}`)
  console.log(`  whole-herd totals: ${JSON.stringify(sim.deathTotals())}`)

  return {
    seed,
    seedYoung,
    foundingCount: foundingStrict.size,
    rows,
    peakBand,
    peakAdults,
    births,
    reproducedFounders: reproduced,
    founderDeaths,
    deaths,
    endRow: rows[rows.length - 1],
    spreadAll: dietSpread(sim.creatures, false),
    spreadAdults: dietSpread(sim.creatures, true),
    totals: sim.deathTotals(),
  }
}

const table: { baseline: RunResult; candidate: RunResult }[] = []
for (const seed of SEEDS) {
  const baseline = run(seed, false)
  const candidate = run(seed, true)
  table.push({ baseline, candidate })
}

console.log('\n=== candidate (n): strict band at the 3000-tick census ===')
let held = 0
for (const { baseline, candidate } of table) {
  const want = RECORDED_BASELINE[candidate.seed]
  const reproduced =
    baseline.endRow.band === want.band &&
    baseline.endRow.population === want.population &&
    baseline.totals.predation === want.predation
  console.log(
    `  seed ${baseline.seed}: baseline reproduces the recorded run (${want.band} / ${want.population} / ${want.predation}): ` +
      `${reproduced ? 'yes' : 'NO - the arms are not one assignment apart'}`,
  )
  console.log(
    `    baseline: band=${baseline.endRow.band} founding=${baseline.endRow.founding}` +
      ` recruits=${baseline.endRow.recruits} adults=${baseline.endRow.recruitsAdult} peak adults=${baseline.peakAdults}` +
      ` population=${baseline.endRow.population}`,
  )
  console.log(
    `    candidate: band=${candidate.endRow.band} founding=${candidate.endRow.founding}` +
      ` recruits=${candidate.endRow.recruits} adults=${candidate.endRow.recruitsAdult} peak adults=${candidate.peakAdults}` +
      ` population=${candidate.endRow.population}`,
  )
  console.log(
    `    baseline offspring: ${describeBirths(baseline.births)}`,
  )
  console.log(
    `    candidate offspring: ${describeBirths(candidate.births)}`,
  )
  console.log(
    `    cohort at the end: baseline ${baseline.endRow.founding}/${baseline.foundingCount} founders alive` +
      ` vs candidate ${candidate.endRow.founding} of ${candidate.foundingCount} seeded young`,
  )
  console.log(`    candidate diets at the end: ${formatSpread(candidate.spreadAdults)}`)
  if (candidate.endRow.band > 0 && candidate.spreadAdults.count > 0) held += 1
}

const met = held >= 2
console.log(
  `\nverdict: under the candidate, ${held} of ${table.length} seeds hold a strict band carrying` +
    ` inherited diets above 0.66 at the 3000-tick census. Bar: 2 of 3. ${met ? 'PASSED' : 'not passed'}.`,
)
