/**
 * Scratch diagnostic (not part of the test suite): the multi-seed recruitment scan
 * that PROGRESS.md §8 asks for before choosing another candidate.
 *
 * The standing result is "a strict-carnivore band at the 3000-tick census on 1
 * seed of 3". Three runs cannot say whether that is a weak mechanism or a working
 * mechanism on a boot-stochastic world, and two different failures hide inside it:
 * a world where the founding strict cohort dies before it ever raises an offspring
 * that inherits carnivory, and a world where it raises young and still loses them.
 * Those need different fixes. So this scan does not look for success — it counts
 * the steps leading up to it on every seed:
 *
 *   1. when the founding strict cohort reaches zero, and of what cause;
 *   2. whether an individual with an inherited diet above the carnivore boundary is
 *      ever born on that seed, and whether its parents were themselves strict
 *      (recruitment) or not (recolonisation out of the herbivore majority);
 *   3. whether the recruited line is self-sustaining — strict young whose parents were
 *      both *born* strict, strict births that land after the founding cohort is gone,
 *      and how deep the parentage chain runs: a seeded founder counts as generation 0,
 *      a child as one past its strictest parent. A chain that keeps growing is a
 *      lineage; a run that only produces first-generation strict young has not
 *      recruited, it has outlived its founders;
 *   4. whether any of those recruits reached its own maturityAge;
 *   5. the band at every census, the peak number of adults it reaches, the population
 *      it lives inside and how often that population sits on the ceiling, and the
 *      inherited diet distribution at the end.
 *
 * The generation depth is read off the parentage the engine already records at
 * breeding. It adds no rule and changes nothing about how the runs behave.
 *
 * The engine is exactly as committed, candidate (m) live. Setting RUN_BASELINE adds
 * a second arm in which `juvenilePlantAllowance` is patched to return zero, which
 * is the committed engine without (m); that arm is reported for contrast, the
 * scan's own question is the rate on the committed engine.
 *
 *   npx vite-node tests/scratch-recruitment-scan.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'
import type { Genome, Phenotype } from '../src/sim/traits'
import type { DeathCause } from '../src/sim/types'

const TICKS = 3000
const CHUNK = 250
const STRICT = 0.66
const SEEDS: string[] = []
for (let i = 1; SEEDS.length < 12; i++) SEEDS.push(i === 1 ? 'evolab' : `evolab-${i}`)

// The scan's question is the rate on the committed engine. Flip this to true to run
// the same seeds again with candidate (m) switched off, for contrast.
const RUN_BASELINE = true

interface Row {
  tick: number
  band: number
  bandAdults: number
  founding: number
  population: number
}

interface SeedReport {
  seed: string
  allowanceOn: boolean
  founders: number
  /** Tick at which the founding strict cohort reached zero; null if founders survive the run. */
  cohortEndTick: number | null
  founderCauses: Map<string, number>
  strictBirths: number
  strictBirthsWithStrictParent: number
  /** Strict births where both parents are strict animals. */
  strictBirthsFromTwoStrictParents: number
  /** Strict births where both parents are strict animals that were born into the lineage rather than seeded. */
  strictBirthsFromTwoBornStrictParents: number
  /** Strict young raised by a strict parent after the seeded cohort was already gone. */
  lineageBirthsAfterCohortEnd: number
  /** Deepest lineage reached. 1 = a strict parent, 2 = both parents strict, 2 or more = the lineage bred on its own. */
  deepestStrictLineage: number
  birthsByGeneration: Map<number, number>
  firstStrictBirthTick: number | null
  recruitsThatMatured: number
  recruitCauses: Map<string, number>
  peakBandAdults: number
  firstBandTick: number | null
  rows: Row[]
  peakPopulation: number
  capCensuses: number
  predation: number
  /** Inherited diets of the whole population and of the band, at the final census. */
  populationMeanDiet: number
  bandSpread: { count: number; mean: number }
}

function dietOf(c: Creature): number {
  return c.genome[TRAIT_INDEX.diet]
}

/**
 * Inherited-diet census of the living population. Mean genome diet is the number
 * PROGRESS.md §6B reports sliding from 0.08 to 0.05, which is what makes carnivory
 * un-recolonisable; it is recorded here so a run can be read as a dead world or as
 * a world whose genomes merely drifted.
 */
function dietCensus(sim: Simulation): { populationMean: number; count: number; bandCount: number; bandMean: number } {
  let total = 0
  let n = 0
  let bandTotal = 0
  let bandCount = 0
  for (const c of sim.creatures) {
    if (!c.alive) continue
    const d = dietOf(c)
    total += d
    n += 1
    if (d > STRICT) {
      bandTotal += d
      bandCount += 1
    }
  }
  return { populationMean: n ? total / n : 0, count: n, bandCount, bandMean: bandCount ? bandTotal / bandCount : 0 }
}

function bump(map: Map<string, number>, cause: string): void {
  map.set(cause, (map.get(cause) ?? 0) + 1)
}

function formatCauses(map: Map<string, number>): string {
  if (map.size === 0) return 'none'
  return [...map.entries()].map(([cause, n]) => `${cause} ${n}`).join(', ')
}

function formatGenerations(map: Map<number, number>): string {
  if (map.size === 0) return 'none'
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([generation, n]) => `g${generation} ${n}`)
    .join(', ')
}

function run(seed: string, allowanceOn: boolean): SeedReport {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  const cap = config.population.maxCreatures

  const engine = sim as unknown as {
    juvenilePlantAllowance: (c: Creature) => number
    kill: (c: Creature, cause: DeathCause) => void
    makeCreature: (
      genome: Genome,
      phenotype: Phenotype,
      speciesId: number,
      tile: number,
      birthTick: number,
      parentA: number,
      parentB: number,
      mate: number
    ) => Creature
  }

  // The arm without candidate (m). Every branch the candidate adds sits behind
  // `allowance > 0`, so with this patch none of them runs and no extra random
  // number is drawn: that arm is the engine exactly as committed.
  if (!allowanceOn) engine.juvenilePlantAllowance = () => 0

  const isStrict = (c: Creature): boolean => dietOf(c) > STRICT
  const isYoung = (c: Creature): boolean => c.age < c.phenotype.maturityAge

  // The founding strict cohort, read before any tick has run. Founders are created
  // by the constructor, so the birth hook below only ever sees births.
  const foundingIds = new Set<number>()
  for (const c of sim.creatures) {
    if (isStrict(c)) foundingIds.add(c.id)
  }

  let livingFounders = foundingIds.size
  let strictBirths = 0
  let strictBirthsFromStrictParent = 0
  let recruitsThatMatured = 0
  let cohortEndTick: number | null = null
  let firstStrictBirthTick: number | null = null
  const founderCauses = new Map<string, number>()
  const recruitCauses = new Map<string, number>()

  // Birth hook: counts every individual the engine creates whose inherited diet is
  // above the carnivore boundary, and reads the parent ids the engine itself passes.
  // The wrapper draws no random number and changes nothing the engine sees, so both
  // arms stay deterministic.
  //
  // "A strict animal was born" is three different questions, and the earlier 1000-tick
  // scans only ever answered the first of them:
  //
  //   born from a strict parent - one parent is a strict animal. The six seeded
  //   carnivores satisfy this on their very first offspring, so it says nothing about
  //   a lineage.
  //   born from two strict parents - both parents are strict animals.
  //   born from two strict parents that were themselves born in the simulation - the
  //   recruitment step. A carnivore population breeding its own young with no seeded
  //   animal anywhere in the parentage.
  //
  // Each birth also records how deep a chain of strict parents it sits at the end of:
  // 1 plus the deepest strict parent, where an animal with no strict parent starts at
  // 0. Founders and strict young born of two non-strict parents therefore both start a
  // chain at 0, so a chain only grows while strict animals keep producing strict young.
  // The chains are a way of reading the three counts above; the counts themselves are
  // read straight from the parentage, which is what decides anything.
  //
  // An inherited diet only changes at birth, so every strict animal is either a founder
  // or has an entry in this map.
  const generationOf = new Map<number, number>()
  for (const id of foundingIds) generationOf.set(id, 0)

  let strictBirthsFromTwoStrictParents = 0
  let strictBirthsFromTwoBornStrictParents = 0
  let deepestStrictLineage = 0
  let lineageBirthsAfterCohortEnd = 0
  const birthsByGeneration = new Map<number, number>()
  const makeInner = engine.makeCreature.bind(sim)
  engine.makeCreature = (genome, phenotype, speciesId, tile, birthTick, parentA, parentB, mate) => {
    const child = makeInner(genome, phenotype, speciesId, tile, birthTick, parentA, parentB, mate)
    if (genome[TRAIT_INDEX.diet] > STRICT) {
      strictBirths += 1
      const genA = generationOf.get(parentA) ?? -1
      const genB = generationOf.get(parentB) ?? -1
      const generation = 1 + Math.max(genA, genB, -1)
      if (genA >= 0 || genB >= 0) strictBirthsFromStrictParent += 1
      if (genA >= 0 && genB >= 0) strictBirthsFromTwoStrictParents += 1
      // No seeded animal anywhere in the parentage: both parents are strict animals
      // the engine raised itself. That is the recruitment step.
      if (genA >= 0 && genB >= 0 && !foundingIds.has(parentA) && !foundingIds.has(parentB)) {
        strictBirthsFromTwoBornStrictParents += 1
      }
      if (generation > deepestStrictLineage) deepestStrictLineage = generation
      if (cohortEndTick !== null && birthTick > cohortEndTick && (genA >= 0 || genB >= 0)) {
        lineageBirthsAfterCohortEnd += 1
      }
      generationOf.set(child.id, generation)
      birthsByGeneration.set(generation, (birthsByGeneration.get(generation) ?? 0) + 1)
      if (firstStrictBirthTick === null) firstStrictBirthTick = birthTick
    }
    return child
  }

  const killInner = engine.kill.bind(sim)
  engine.kill = (c: Creature, cause: DeathCause) => {
    if (isStrict(c)) {
      if (foundingIds.has(c.id)) {
        bump(founderCauses, cause)
        livingFounders -= 1
        if (livingFounders === 0 && cohortEndTick === null) cohortEndTick = sim.tick
      } else {
        bump(recruitCauses, cause)
        // "Reached its own maturityAge" is the exact question every recruitment
        // candidate is being asked; age at death answers it without a second rule.
        if (!isYoung(c)) recruitsThatMatured += 1
      }
    }
    killInner(c, cause)
  }

  const rows: Row[] = []
  let firstBandTick: number | null = null
  let peakBandAdults = 0
  let peakPopulation = 0
  let capCensuses = 0

  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    let band = 0
    let bandAdults = 0
    let founding = 0
    let population = 0
    for (const c of sim.creatures) {
      if (!c.alive) continue
      population += 1
      if (!isStrict(c)) continue
      band += 1
      if (foundingIds.has(c.id)) founding += 1
      else if (!isYoung(c)) bandAdults += 1
    }
    const tick = window * CHUNK
    if (band > 0 && firstBandTick === null) firstBandTick = tick
    if (bandAdults > peakBandAdults) peakBandAdults = bandAdults
    if (population > peakPopulation) peakPopulation = population
    if (population >= cap) capCensuses += 1
    rows.push({ band, bandAdults, founding, population, tick })
  }

  const diet = dietCensus(sim)
  const deaths = sim.deathTotals()

  const report: SeedReport = {
    allowanceOn,
    bandSpread: { count: diet.bandCount, mean: diet.bandMean },
    birthsByGeneration,
    capCensuses,
    cohortEndTick,
    deepestStrictLineage,
    firstBandTick,
    firstStrictBirthTick,
    founderCauses,
    founders: foundingIds.size,
    lineageBirthsAfterCohortEnd,
    peakBandAdults,
    peakPopulation,
    populationMeanDiet: diet.populationMean,
    predation: deaths.predation,
    recruitCauses,
    recruitsThatMatured,
    rows,
    seed,
    strictBirths,
    strictBirthsFromTwoBornStrictParents,
    strictBirthsFromTwoStrictParents,
    strictBirthsWithStrictParent: strictBirthsFromStrictParent,
  }
  return report
}

function num(value: number | null): string {
  return value === null ? 'never' : String(value)
}

function reportSeed(r: SeedReport): void {
  const arm = r.allowanceOn ? 'candidate (m) as committed' : '(m) patched off = engine without the allowance'
  const last = r.rows[r.rows.length - 1]
  console.log(`\n=== seed ${r.seed} - ${arm} ===`)
  console.log(
    `  founding strict cohort ${r.founders}: reached zero at tick ${num(r.cohortEndTick)}` +
      ` [${formatCauses(r.founderCauses)}]`
  )
  console.log(
    `  strict births ${r.strictBirths} (from a strict parent ${r.strictBirthsWithStrictParent}, ` +
      `from non-strict parents ${r.strictBirths - r.strictBirthsWithStrictParent})`
  )
  console.log(
    `  strict lineage: two strict parents ${r.strictBirthsFromTwoStrictParents}, ` +
      `two parents born strict (no seeded animal in the parentage) ${r.strictBirthsFromTwoBornStrictParents}, ` +
      `strict births after the founding cohort was gone ${r.lineageBirthsAfterCohortEnd}, ` +
      `deepest lineage generation ${r.deepestStrictLineage}`
  )
  console.log(`  strict births by lineage generation: ${formatGenerations(r.birthsByGeneration)}`)
  console.log(
    `  first strict birth: ${num(r.firstStrictBirthTick)}   first band sighting: ${num(r.firstBandTick)}   ` +
      `recruits that reached their own maturityAge before dying: ${r.recruitsThatMatured}`
  )
  console.log(`  peak band adults ${r.peakBandAdults}   band at tick 3000: ${last.band} (adults ${last.bandAdults})`)
  console.log(`  population peak ${r.peakPopulation}   censuses at the ceiling: ${r.capCensuses}   predation ${r.predation}`)
  console.log(
    `  inherited diet at 3000: whole population mean ${r.populationMeanDiet.toFixed(3)}, ` +
      `band n=${r.bandSpread.count} mean ${r.bandSpread.mean.toFixed(3)}`
  )
  console.log(`  strict deaths by cause - founding [${formatCauses(r.founderCauses)}] recruits [${formatCauses(r.recruitCauses)}]`)
  for (const row of r.rows) {
    console.log(
      `    tick ${String(row.tick).padStart(4)}  band=${String(row.band).padStart(3)}` +
        ` adults=${String(row.bandAdults).padStart(3)} founding=${String(row.founding).padStart(3)}` +
        `  population=${String(row.population).padStart(5)}`
    )
  }
}

function cell(value: string | number, width: number): string {
  return String(value).padEnd(width)
}

/**
 * The rates the three recorded seeds cannot give: what fraction of seeds get as far
 * as each step of the recruitment chain. Read top to bottom, the first column where
 * the numbers drop to zero is the step the next candidate has to address.
 */
function summarise(reports: SeedReport[], ceiling: number): void {
  const arms: boolean[] = [true]
  if (reports.some((r) => !r.allowanceOn)) arms.push(false)
  for (const allowanceOn of arms) {
    const rows = reports.filter((r) => r.allowanceOn === allowanceOn)
    const label = allowanceOn ? 'candidate (m) as committed' : 'candidate (m) off'
    console.log(`\n=== summary: ${label} - ${rows.length} seeds, ${TICKS} ticks, ceiling ${ceiling} ===`)
    console.log(
      '  ' +
        'seed'.padEnd(12) +
        'cohort gone'.padEnd(13) +
        'first strict birth'.padEnd(19) +
        'strict born'.padEnd(12) +
        'one strict parent'.padEnd(15) +
        'both strict'.padEnd(12) +
        'unseeded parents'.padEnd(17) +
        'post-cohort'.padEnd(12) +
        'deepest'.padEnd(8) +
        'matured'.padEnd(10) +
        'peak adults'.padEnd(13) +
        'band at 3000'.padEnd(13) +
        'mean diet'
    )
    for (const r of rows) {
      const last = r.rows[r.rows.length - 1]
      console.log(
        '  ' +
          cell(r.seed, 12) +
          cell(r.cohortEndTick ?? 'never', 13) +
          cell(r.firstStrictBirthTick ?? 'never', 19) +
          cell(r.strictBirths, 12) +
          cell(r.strictBirthsWithStrictParent, 15) +
          cell(r.strictBirthsFromTwoStrictParents, 12) +
          cell(r.strictBirthsFromTwoBornStrictParents, 17) +
          cell(r.lineageBirthsAfterCohortEnd, 12) +
          cell(r.deepestStrictLineage, 8) +
          cell(r.recruitsThatMatured, 10) +
          cell(r.peakBandAdults, 13) +
          cell(last.band, 13) +
          cell(r.populationMeanDiet.toFixed(3), 13)
      )
    }

    const n = rows.length
    const countSeeds = (test: (r: SeedReport) => boolean): number => rows.filter(test).length
    const total = (pick: (r: SeedReport) => number): number => rows.reduce((sum, r) => sum + pick(r), 0)
    const deepest = rows.reduce((max, r) => Math.max(max, r.deepestStrictLineage), 0)
    console.log(`  founder cohort still alive at ${TICKS}: ${countSeeds((r) => r.cohortEndTick === null)} / ${n}`)
    console.log(`  seeds where a strict individual was ever born: ${countSeeds((r) => r.strictBirths > 0)} / ${n}`)
    console.log(
      '  strict young by parentage, summed over seeds: one strict parent ' +
        `${total((r) => r.strictBirthsWithStrictParent) - total((r) => r.strictBirthsFromTwoStrictParents)}, ` +
        `two strict parents ${total((r) => r.strictBirthsFromTwoStrictParents)}, of those with no seeded animal in ` +
        `the parentage ${total((r) => r.strictBirthsFromTwoBornStrictParents)}, deepest lineage generation ${deepest}`
    )
    console.log(
      `  seeds where a strict young had a strict parent: ` +
        `${countSeeds((r) => r.strictBirthsWithStrictParent > 0)} / ${n}; two strict parents ` +
        `${countSeeds((r) => r.strictBirthsFromTwoStrictParents > 0)} / ${n}; of those with no seeded animal in the ` +
        `parentage ${countSeeds((r) => r.strictBirthsFromTwoBornStrictParents > 0)} / ${n}`
    )
    console.log(
      `  strict young born after the founding cohort was already gone: ` +
        `${total((r) => r.lineageBirthsAfterCohortEnd)} births on ` +
        `${countSeeds((r) => r.lineageBirthsAfterCohortEnd > 0)} / ${n} seeds`
    )
    console.log(
      `  seeds where a strict young reached its own maturityAge: ` +
        `${countSeeds((r) => r.recruitsThatMatured > 0)} / ${n}`
    )
    console.log(
      `  seeds with a band at tick ${TICKS}: ${countSeeds((r) => r.rows[r.rows.length - 1].band > 0)} / ${n}`
    )
  }
}

function main(): void {
  const ceiling = defaultConfig().population.maxCreatures
  console.log(
    `recruitment scan: ${SEEDS.length} seeds, ${TICKS} ticks, census every ${CHUNK}, ` +
      `strict = inherited diet > ${STRICT}, population ceiling ${ceiling}`
  )
  const reports: SeedReport[] = []
  for (const seed of SEEDS) {
    const report = run(seed, true)
    reports.push(report)
    reportSeed(report)
    if (RUN_BASELINE) {
      const baseline = run(seed, false)
      reports.push(baseline)
      reportSeed(baseline)
    }
  }
  summarise(reports, ceiling)
}

main()
