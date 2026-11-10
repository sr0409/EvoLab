/**
 * Genomes: heritable traits, their bounds, inheritance (crossover) and mutation.
 *
 * A genome is a fixed-length Float32Array. Trait order is defined once here and
 * everything else (phenotypes, statistics, UI, saves) indexes into it through
 * TRAIT_INDEX, so adding a trait only means appending a definition.
 *
 * Every trait is clamped to [min, max]; `spread` is the standard deviation of a
 * mutation relative to the trait's own range, and `volatility` is a per-trait
 * multiplier on the global mutation rate. This makes "mutation rate" configurable
 * while still letting fast-evolving traits (colour, aggression) evolve faster
 * than slow ones (body size, lifespan).
 */

import { Rng } from './rng'
import { clamp } from './noise'
import { dietClassOf, type DietClass } from './types'

export interface TraitDef {
  key: string
  label: string
  min: number
  max: number
  /** Starting value for founder organisms of each diet archetype. */
  founders: { herbivore: number; carnivore: number; omnivore: number }
  /** Mutation magnitude as a fraction of the trait range. */
  spread: number
  /** Per-trait mutation-rate multiplier. */
  volatility: number
  /** Relative contribution to the genome distance metric. */
  weight: number
  unit: string
  /** Short explanation shown in tooltips. */
  help: string
  format: (v: number) => string
  /** Optional note explaining the selection tradeoff. */
  tradeoff?: string
}

const num = (v: number) => v.toFixed(2)
const pct = (v: number) => `${Math.round(v * 100)}%`
const int = (v: number) => String(Math.round(v))
const deg = (v: number) => `${v.toFixed(1)}°C`

const TRAITS_LIST: TraitDef[] = [
  {
    key: 'speed',
    label: 'Sprint speed',
    min: 0.15,
    max: 2.4,
    // Carnivore founders must be meaningfully faster than their prey: with a
    // 0.2 tiles/tick closing speed no hunt ever lands inside a carnivore's
    // energy grace period (see tests/scratch.test.ts for the measurement).
    founders: { herbivore: 1.15, carnivore: 1.8, omnivore: 1.1 },
    spread: 0.18,
    volatility: 1.0,
    weight: 1.4,
    unit: 'tiles/tick',
    help: 'Maximum movement speed. Fast individuals catch prey and escape predators, but movement cost rises with the square of speed.',
    format: num,
    tradeoff: 'Higher speed costs disproportionately more energy.'
  },
  {
    key: 'sense',
    label: 'Perception range',
    min: 0.8,
    max: 14,
    founders: { herbivore: 5.5, carnivore: 7.5, omnivore: 6 },
    spread: 0.2,
    volatility: 1.0,
    weight: 1.2,
    unit: 'tiles',
    help: 'How far a creature senses food, mates and threats. Wide perception is paid for every tick it is maintained.',
    format: num,
    tradeoff: 'Perception costs energy every tick whether or not anything is sensed.'
  },
  {
    key: 'metabolism',
    label: 'Metabolic rate',
    min: 0.35,
    max: 2.0,
    founders: { herbivore: 0.9, carnivore: 1.15, omnivore: 1.0 },
    spread: 0.16,
    volatility: 0.8,
    weight: 1.5,
    unit: '×baseline',
    help: 'Basal energy burn. High metabolism means more activity and better cold tolerance, but a bigger daily food requirement.',
    format: num,
    tradeoff: 'More energy spent every tick; reserves burn first when food is short.'
  },
  {
    key: 'size',
    label: 'Body size',
    min: 0.05,
    max: 1.0,
    founders: { herbivore: 0.34, carnivore: 0.5, omnivore: 0.4 },
    spread: 0.1,
    volatility: 0.55,
    weight: 1.6,
    unit: 'body length',
    help: 'Body length. Larger bodies store more energy and dominate conflicts, but need far more food and mature later.',
    format: num,
    tradeoff: 'Energy demand grows faster than intake; large species evolve slowly.'
  },
  {
    key: 'diet',
    label: 'Diet bias',
    min: 0,
    max: 1,
    founders: { herbivore: 0.08, carnivore: 0.9, omnivore: 0.5 },
    spread: 0.14,
    volatility: 0.9,
    weight: 2.0,
    unit: 'plant ↔ animal',
    help: '0 = strict herbivore, 0.5 = omnivore, 1 = strict carnivore. Determines what a creature forages for and whom it attacks.',
    format: num,
    tradeoff: 'Specialists are efficient in their niche and vulnerable when it collapses.'
  }
]


const EXTRA_TRAITS: TraitDef[] = [
  {
    key: 'aggression',
    label: 'Aggression',
    min: 0,
    max: 1,
    founders: { herbivore: 0.25, carnivore: 0.75, omnivore: 0.5 },
    spread: 0.22,
    volatility: 1.1,
    weight: 1.0,
    unit: '0–1',
    help: 'Willingness to attack other creatures, including rivals of the same species. Drives predation success and conflict deaths.',
    format: pct,
    tradeoff: 'Conflicts injure both sides; aggressive individuals die younger.'
  },
  {
    key: 'reproInvestment',
    label: 'Reproductive investment',
    min: 0.1,
    max: 1,
    founders: { herbivore: 0.55, carnivore: 0.5, omnivore: 0.55 },
    spread: 0.18,
    volatility: 0.9,
    weight: 1.1,
    unit: 'share of reserve',
    help: 'Fraction of the parent’s energy reserve invested in each brood. High investment means fewer, better provisioned offspring.',
    format: pct,
    tradeoff: 'Heavy investment can push the parent close to starvation.'
  },
  {
    key: 'litterSize',
    label: 'Brood size',
    min: 1,
    max: 7,
    founders: { herbivore: 3.2, carnivore: 1.8, omnivore: 2.4 },
    spread: 0.22,
    volatility: 1.0,
    weight: 1.3,
    unit: 'offspring',
    help: 'Number of offspring per breeding event (rounded from the heritable value).',
    format: int,
    tradeoff: 'Many cheap offspring versus few expensive ones — the r/K trade-off.'
  },
  {
    key: 'maturityAge',
    label: 'Age at maturity',
    min: 15,
    max: 500,
    founders: { herbivore: 90, carnivore: 140, omnivore: 110 },
    spread: 0.16,
    volatility: 0.9,
    weight: 1.4,
    unit: 'ticks',
    help: 'Earliest tick at which a creature can breed. Early maturity speeds evolution but produces smaller offspring.',
    format: int,
    tradeoff: 'Early breeders carry fewer reserves and burn slightly hotter.'
  },
  {
    key: 'maxAge',
    label: 'Maximum lifespan',
    min: 120,
    max: 4000,
    founders: { herbivore: 900, carnivore: 1100, omnivore: 1000 },
    spread: 0.14,
    volatility: 0.7,
    weight: 1.2,
    unit: 'ticks',
    help: 'Genetic lifespan ceiling. Long-lived lineages buffer bad years; short-lived ones adapt faster.',
    format: int,
    tradeoff: 'Long lifespans slow generational turnover and adaptation.'
  },
  {
    key: 'digest',
    label: 'Assimilation efficiency',
    min: 0.3,
    max: 0.98,
    founders: { herbivore: 0.6, carnivore: 0.72, omnivore: 0.66 },
    spread: 0.12,
    volatility: 0.7,
    weight: 1.3,
    unit: 'absorbed fraction',
    help: 'Fraction of ingested food energy actually absorbed. The remainder is excreted into the detritus pool.',
    format: pct,
    tradeoff: 'Waste still returns nutrients to the soil, so low efficiency is not pure loss.'
  },
  {
    key: 'thermalOptimum',
    label: 'Thermal optimum',
    min: -22,
    max: 44,
    founders: { herbivore: 22, carnivore: 20, omnivore: 21 },
    spread: 0.22,
    volatility: 1.2,
    weight: 1.5,
    unit: '°C',
    help: 'The temperature at which this organism performs best. Deviation beyond tolerance causes heat or cold stress.',
    format: deg,
    tradeoff: 'Specialising to today’s climate is a bet against tomorrow’s.'
  },
  {
    key: 'thermalTolerance',
    label: 'Thermal tolerance',
    min: 2,
    max: 30,
    founders: { herbivore: 11, carnivore: 10, omnivore: 12 },
    spread: 0.2,
    volatility: 0.9,
    weight: 1.0,
    unit: '°C ±',
    help: 'How far from the optimum an organism can operate before it starts taking damage.',
    format: num,
    tradeoff: 'Broad tolerance is expensive to maintain in a stable climate.'
  },
  {
    key: 'immune',
    label: 'Disease resistance',
    min: 0,
    max: 1,
    founders: { herbivore: 0.5, carnivore: 0.55, omnivore: 0.5 },
    spread: 0.2,
    volatility: 0.9,
    weight: 0.8,
    unit: '0–1',
    help: 'Resistance to infection. Disease risk grows with crowding, heat and starvation.',
    format: pct,
    tradeoff: 'Immunity is costly; dense populations select hard for it.'
  },
  {
    key: 'sociality',
    label: 'Sociality',
    min: 0,
    max: 1,
    founders: { herbivore: 0.7, carnivore: 0.35, omnivore: 0.45 },
    spread: 0.25,
    volatility: 1.2,
    weight: 0.9,
    unit: '0–1',
    help: 'Attraction to members of the same species. High sociality produces herds and packs; low sociality produces solitary territorial animals.',
    format: pct,
    tradeoff: 'Crowds help find mates and dilute predation, but spread disease.'
  },
  {
    key: 'hue',
    label: 'Colour (hue)',
    min: 0,
    max: 360,
    founders: { herbivore: 95, carnivore: 20, omnivore: 200 },
    spread: 0.14,
    volatility: 2.0,
    weight: 0.25,
    unit: '°',
    help: 'Visible coloration. Neutral with respect to energy in this model, so it drifts — a useful marker of lineage divergence.',
    format: int
  },
  {
    key: 'pattern',
    label: 'Colour (banding)',
    min: 0,
    max: 1,
    founders: { herbivore: 0.4, carnivore: 0.7, omnivore: 0.2 },
    spread: 0.25,
    volatility: 2.0,
    weight: 0.2,
    unit: '0–1',
    help: 'Striping/spotting intensity. Neutral marker trait used for banding in the renderer.',
    format: pct
  }
]

for (const trait of EXTRA_TRAITS) TRAITS_LIST.push(trait)

/** Ordered trait definitions. Index order is the genome layout. */
export const TRAITS: readonly TraitDef[] = TRAITS_LIST

export const TRAIT_COUNT = TRAITS.length

export const TRAIT_INDEX: Record<string, number> = {}
for (let i = 0; i < TRAITS.length; i++) TRAIT_INDEX[TRAITS[i].key] = i

export const TRAIT_MIN = new Float64Array(TRAIT_COUNT)
export const TRAIT_MAX = new Float64Array(TRAIT_COUNT)
export const TRAIT_RANGE = new Float64Array(TRAIT_COUNT)
for (let i = 0; i < TRAIT_COUNT; i++) {
  TRAIT_MIN[i] = TRAITS[i].min
  TRAIT_MAX[i] = TRAITS[i].max
  TRAIT_RANGE[i] = Math.max(1e-9, TRAITS[i].max - TRAITS[i].min)
}

/** A genome is just a Float32Array laid out in trait order. */
export type Genome = Float32Array

export function newGenome(): Genome {
  return new Float32Array(TRAIT_COUNT)
}

export function cloneGenome(genome: Genome): Genome {
  return new Float32Array(genome)
}

export function clampGenome(genome: Genome): void {
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const v = genome[i]
    genome[i] = v < TRAIT_MIN[i] ? TRAIT_MIN[i] : v > TRAIT_MAX[i] ? TRAIT_MAX[i] : v
  }
}

/** Founder genome for a diet archetype, jittered so founders are not clones. */
export function founderGenome(rng: Rng, archetype: DietClass, jitter = 0.35): Genome {
  const g = new Float32Array(TRAIT_COUNT)
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const def = TRAITS[i]
    const base = def.founders[archetype]
    const sigma = (def.max - def.min) * def.spread * jitter
    g[i] = clamp(base + rng.gaussian(0, sigma), def.min, def.max)
  }
  return g
}

/** Circular difference for cyclic traits (hue), normalised to 0..1. */
function circularDiff(a: number, b: number, span: number): number {
  let d = Math.abs(a - b) % span
  if (d > span / 2) d = span - d
  return d / (span / 2)
}

/**
 * Normalised genetic distance in [0, 1]: the weighted root-mean-square of
 * range-normalised per-trait differences. Used both for speciation detection and
 * for mate compatibility.
 */
export function genomeDistance(a: Genome, b: Genome): number {
  let sum = 0
  let weightTotal = 0
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const def = TRAITS[i]
    const d = def.key === 'hue' ? circularDiff(a[i], b[i], 360) : Math.abs(a[i] - b[i]) / TRAIT_RANGE[i]
    sum += def.weight * d * d
    weightTotal += def.weight
  }
  return Math.sqrt(sum / weightTotal)
}

/** Mean absolute distance to a reference genome (used for divergence plots). */
export function genomeDivergence(a: Genome, reference: Genome): number {
  let sum = 0
  for (let i = 0; i < TRAIT_COUNT; i++) sum += Math.abs(a[i] - reference[i]) / TRAIT_RANGE[i]
  return sum / TRAIT_COUNT
}

export function blendTowards(target: Genome, source: Genome, amount: number): void {
  for (let i = 0; i < TRAIT_COUNT; i++) target[i] += (source[i] - target[i]) * amount
}

export function copyInto(target: Genome, source: Genome): void {
  target.set(source)
}

/**
 * Inheritance: per-trait choice of one parent's allele, occasionally an
 * intermediate value (incomplete dominance), with a small number of inherited
 * "blocks" so traits stay partially linked rather than being shuffled freely.
 */
export function inherit(rng: Rng, a: Genome, b: Genome, out: Genome): void {
  const blocks = 1 + rng.int(3)
  const boundaries = 1 + rng.int(Math.max(1, TRAIT_COUNT - 1))
  let parent = rng.random() < 0.5 ? 0 : 1
  let swapAt = Math.min(TRAIT_COUNT - 1, Math.floor((boundaries + 1) * 0.5))
  for (let i = 0; i < TRAIT_COUNT; i++) {
    if (i === swapAt) {
      parent = 1 - parent
      swapAt = Math.min(TRAIT_COUNT - 1, swapAt + Math.max(1, Math.floor(TRAIT_COUNT / Math.max(1, blocks))))
    }
    const from = parent === 0 ? a : b
    const other = parent === 0 ? b : a
    if (rng.random() < 0.15) out[i] = from[i] + (other[i] - from[i]) * rng.random()
    else out[i] = from[i]
  }
}

/**
 * Mutation. Each trait mutates with probability mutationRate * volatility with a
 * gaussian magnitude proportional to its spread. A rare "mutation burst" jumps a
 * small random set of traits further, which is what lets new lineages appear.
 * Returns the number of traits that actually changed.
 */
export function mutate(rng: Rng, genome: Genome, mutationRate: number, strength = 1): number {
  let changed = 0
  const burst = rng.random() < 0.03
  let burstLeft = burst ? 1 + rng.int(4) : 0
  for (let i = 0; i < TRAIT_COUNT; i++) {
    let p = mutationRate * TRAITS[i].volatility
    if (burstLeft > 0) {
      p += 0.4
      burstLeft--
    }
    if (rng.random() > p) continue
    const span = TRAIT_RANGE[i]
    const sigma = span * TRAITS[i].spread * strength * 0.6
    const before = genome[i]
    const after = clamp(before + rng.gaussian(0, sigma), TRAIT_MIN[i], TRAIT_MAX[i])
    genome[i] = after
    if (after !== before) changed++
  }
  return changed
}


/** Physiological constants derived from a genome. Computed once, at birth. */
export interface Phenotype {
  speed: number
  senseRadius: number
  mass: number
  basalRate: number
  moveCostCoefficient: number
  senseCost: number
  maxEnergy: number
  bitePlant: number
  bitePrey: number
  attackDamage: number
  diet: number
  plantShare: number
  animalShare: number
  digest: number
  reproThresholdEnergy: number
  broodEnergyPerOffspring: number
  litterSize: number
  maturityAge: number
  maxAge: number
  reproCooldownTicks: number
  thermalOptimum: number
  thermalTolerance: number
  immune: number
  sociality: number
  hue: number
  pattern: number
  aggression: number
  bodyLength: number
  mineralMax: number
  mineralDrain: number
  dietClass: DietClass
}

/**
 * Genome -> physiology. Allometry is deliberately sub-linear (Kleiber-like):
 * intake scales with mass^0.62 while cost scales with mass^0.75, which is what
 * makes large bodies expensive and slow to evolve.
 */
export function buildPhenotype(genome: Genome): Phenotype {
  const speed = genome[TRAIT_INDEX.speed]
  const sense = genome[TRAIT_INDEX.sense]
  const metabolicRate = genome[TRAIT_INDEX.metabolism]
  const bodyLength = genome[TRAIT_INDEX.size]
  const diet = genome[TRAIT_INDEX.diet]
  const aggression = genome[TRAIT_INDEX.aggression]
  const reproInvestment = genome[TRAIT_INDEX.reproInvestment]
  const litterSize = Math.max(1, Math.round(genome[TRAIT_INDEX.litterSize]))
  const maturityAge = Math.max(10, Math.round(genome[TRAIT_INDEX.maturityAge]))
  const maxAge = Math.max(30, Math.round(genome[TRAIT_INDEX.maxAge]))
  const digest = genome[TRAIT_INDEX.digest]
  const thermalOptimum = genome[TRAIT_INDEX.thermalOptimum]
  const thermalTolerance = Math.max(1.5, genome[TRAIT_INDEX.thermalTolerance])
  const immune = genome[TRAIT_INDEX.immune]
  const sociality = genome[TRAIT_INDEX.sociality]
  const hue = genome[TRAIT_INDEX.hue]
  const pattern = genome[TRAIT_INDEX.pattern]

  const mass = 0.04 + 3.4 * Math.pow(bodyLength, 2.6)
  const massTo075 = Math.pow(mass, 0.75)
  const basalRate = (0.05 + 0.3 * metabolicRate) * massTo075 * (1 + 0.06 * (maturityAge / 400))
  const moveCostCoefficient = 0.1 * Math.pow(mass, 0.7) * (0.7 + 0.5 * metabolicRate)
  const senseCost = 0.012 * sense * (0.6 + 0.5 * metabolicRate) * Math.pow(mass, 0.4)
  const maxEnergy = 6 + 16 * mass
  const maxIntake = 1.25 * Math.pow(mass, 0.62)
  const broodEnergyPerOffspring = (1.2 + 3.4 * mass) * (0.4 + 0.9 * reproInvestment)

  return {
    speed,
    senseRadius: sense,
    mass,
    basalRate,
    moveCostCoefficient,
    senseCost,
    maxEnergy,
    bitePlant: maxIntake * (0.5 + 0.5 * (1 - diet)),
    bitePrey: maxIntake * (0.3 + 0.7 * diet),
    attackDamage: (0.15 + 0.45 * aggression) * (0.25 + 0.75 * Math.pow(mass, 0.55)),
    diet,
    plantShare: 1 - diet,
    animalShare: diet,
    digest,
    reproThresholdEnergy: maxEnergy * (0.5 + 0.25 * reproInvestment),
    broodEnergyPerOffspring,
    litterSize,
    maturityAge,
    maxAge,
    reproCooldownTicks: 10 + 0.35 * maturityAge + 2 * litterSize,
    thermalOptimum,
    thermalTolerance,
    immune,
    sociality,
    hue,
    pattern,
    aggression,
    bodyLength,
    mineralMax: 1 + 2.5 * mass,
    mineralDrain: 0.004 * Math.pow(mass, 0.6),
    dietClass: dietClassOf(diet)
  }
}

/** Human-readable genome listing for the inspector panel. */
export function describeGenome(genome: Genome): Array<{ key: string; label: string; value: string; help: string; tradeoff: string }> {
  const rows: Array<{ key: string; label: string; value: string; help: string; tradeoff: string }> = []
  for (let i = 0; i < TRAIT_COUNT; i++) {
    const def = TRAITS[i]
    rows.push({
      key: def.key,
      label: def.label,
      value: def.format(genome[i]),
      help: def.help,
      tradeoff: def.tradeoff ?? ''
    })
  }
  return rows
}

