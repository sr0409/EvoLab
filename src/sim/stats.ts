/**
 * Measurement layer: a census of the living population plus long-lived numeric
 * series for the dashboard.
 *
 * `computeCensus` takes the smallest structural view it needs (`AgentView`), so
 * the tracker is independent of the creature representation and can be unit
 * tested against hand-built agents.
 */
import { TRAIT_COUNT, TRAIT_INDEX, TRAIT_MIN } from './traits'
import { dietClassOf, type DietClass } from './types'

/** Structural view of a creature, satisfied by `Creature`. */
export interface AgentView {
  speciesId: number
  age: number
  energy: number
  maxEnergy: number
  health: number
  genome: Float32Array
  offspringCount: number
  /** Environmental temperature the agent last experienced (°C). */
  localTemperature: number
}

export interface CensusRecord {
  tick: number
  population: number
  herbivores: number
  omnivores: number
  carnivores: number
  /** Mean diet gene of the living population: 0 plant-only, 1 strict meat. */
  meanDiet: number
  speciesAlive: number
  speciesTotal: number
  births: number
  deaths: number
  temperature: number
  biomass: number
  detritus: number
  mineral: number
  meanAge: number
  meanSpeed: number
  meanSize: number
  meanMetabolism: number
  meanBrood: number
  meanLifespan: number
  meanThermalOptimum: number
  /** Mean |thermal optimum − experienced temperature|; falls as a population adapts. */
  thermalMismatch: number
  meanHealth: number
  meanEnergyRatio: number
  /** Mean lifetime offspring among adults: the fitness proxy used by the charts. */
  meanFitness: number
  /** Energy fixed by primary production per animal last tick. */
  foodPerAnimal: number
}

export const CENSUS_FIELDS = [
  'population',
  'herbivores',
  'omnivores',
  'carnivores',
  'meanDiet',
  'speciesAlive',
  'births',
  'deaths',
  'temperature',
  'biomass',
  'detritus',
  'mineral',
  'meanAge',
  'meanSpeed',
  'meanSize',
  'meanMetabolism',
  'meanBrood',
  'meanLifespan',
  'meanThermalOptimum',
  'thermalMismatch',
  'meanHealth',
  'meanEnergyRatio',
  'meanFitness',
  'foodPerAnimal'
] as const

export type CensusField = (typeof CENSUS_FIELDS)[number]

export const CENSUS_FIELD_LABELS: Record<CensusField, string> = {
  population: 'Population',
  herbivores: 'Herbivores',
  omnivores: 'Omnivores',
  carnivores: 'Carnivores',
  meanDiet: 'Mean diet gene (0 plant → 1 meat)',
  speciesAlive: 'Living species',
  births: 'Births / tick',
  deaths: 'Deaths / tick',
  temperature: 'Mean temperature (°C)',
  biomass: 'Plant biomass (E)',
  detritus: 'Detritus (E)',
  mineral: 'Available minerals',
  meanAge: 'Mean age',
  meanSpeed: 'Mean speed',
  meanSize: 'Mean body size',
  meanMetabolism: 'Mean metabolic rate',
  meanBrood: 'Mean brood size',
  meanLifespan: 'Mean maximum lifespan',
  meanThermalOptimum: 'Mean thermal optimum (°C)',
  thermalMismatch: 'Thermal mismatch (°C)',
  meanHealth: 'Mean health',
  meanEnergyRatio: 'Mean energy reserves',
  meanFitness: 'Mean offspring per adult',
  foodPerAnimal: 'Primary production per animal'
}

/** Census a population, and count living members per species. */
export function computeCensus(
  agents: readonly AgentView[],
  tick: number,
  speciesCount: number,
  world: { temperatureMean: number; biomass: number; detritus: number; mineral: number; gpp: number }
): { census: CensusRecord; speciesCounts: Int32Array } {
  const byDiet: Record<DietClass, number> = { herbivore: 0, omnivore: 0, carnivore: 0 }
  const sumGenome = new Float64Array(TRAIT_COUNT)
  const speciesCounts = new Int32Array(Math.max(1, speciesCount))
  let sumAge = 0
  let sumHealth = 0
  let sumEnergyRatio = 0
  let sumOffspring = 0
  let sumMismatch = 0
  let adults = 0

  for (const agent of agents) {
    byDiet[dietClassOf(agent.genome[TRAIT_INDEX.diet])]++
    sumAge += agent.age
    sumHealth += agent.health
    sumEnergyRatio += agent.maxEnergy > 0 ? clamp01(agent.energy / agent.maxEnergy) : 0
    sumOffspring += agent.offspringCount
    sumMismatch += Math.abs(agent.genome[TRAIT_INDEX.thermalOptimum] - agent.localTemperature)
    if (agent.offspringCount > 0) adults++
    if (agent.speciesId >= 0 && agent.speciesId < speciesCounts.length) speciesCounts[agent.speciesId]++
    for (let t = 0; t < TRAIT_COUNT; t++) sumGenome[t] += agent.genome[t]
  }

  const n = agents.length
  const inv = n > 0 ? 1 / n : 0
  const meanOf = (trait: number) => sumGenome[trait] * inv

  const census: CensusRecord = {
    tick,
    population: n,
    herbivores: byDiet.herbivore,
    omnivores: byDiet.omnivore,
    carnivores: byDiet.carnivore,
    meanDiet: meanOf(TRAIT_INDEX.diet),
    speciesAlive: 0,
    speciesTotal: speciesCount,
    births: 0,
    deaths: 0,
    temperature: world.temperatureMean,
    biomass: world.biomass,
    detritus: world.detritus,
    mineral: world.mineral,
    meanAge: sumAge * inv,
    meanSpeed: meanOf(TRAIT_INDEX.speed),
    meanSize: meanOf(TRAIT_INDEX.size),
    meanMetabolism: meanOf(TRAIT_INDEX.metabolism),
    meanBrood: meanOf(TRAIT_INDEX.litterSize),
    meanLifespan: meanOf(TRAIT_INDEX.maxAge),
    meanThermalOptimum: meanOf(TRAIT_INDEX.thermalOptimum),
    thermalMismatch: sumMismatch * inv,
    meanHealth: sumHealth * inv,
    meanEnergyRatio: sumEnergyRatio * inv,
    meanFitness: adults > 0 ? sumOffspring / adults : 0,
    foodPerAnimal: n > 0 ? world.gpp / n : 0
  }
  return { census, speciesCounts }
}

export function meanTrait(agents: readonly AgentView[], traitIndex: number): number {
  if (!agents.length) return 0
  let sum = 0
  for (const agent of agents) sum += agent.genome[traitIndex]
  return sum / agents.length
}

export function traitRange(agents: readonly AgentView[], traitIndex: number): { min: number; max: number } {
  if (!agents.length) return { min: TRAIT_MIN[traitIndex], max: TRAIT_MIN[traitIndex] }
  let min = Infinity
  let max = -Infinity
  for (const agent of agents) {
    const value = agent.genome[traitIndex]
    if (value < min) min = value
    if (value > max) max = value
  }
  return { min, max }
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value
}

/** Fixed-capacity ring buffer of (tick, value) samples. */
export class SeriesBuffer {
  private ticks: Float64Array
  private values: Float64Array
  private head = 0
  private count = 0
  readonly capacity: number

  constructor(capacity = 20000) {
    this.capacity = capacity
    this.ticks = new Float64Array(capacity)
    this.values = new Float64Array(capacity)
  }

  push(tick: number, value: number): void {
    if (this.count < this.capacity) {
      this.ticks[this.count] = tick
      this.values[this.count] = value
      this.count++
      return
    }
    this.ticks[this.head] = tick
    this.values[this.head] = value
    this.head = (this.head + 1) % this.capacity
  }

  get length(): number {
    return this.count
  }

  private slot(i: number): number {
    return (this.head + i) % this.capacity
  }

  tickAt(i: number): number {
    return this.ticks[this.slot(i)]
  }

  valueAt(i: number): number {
    return this.values[this.slot(i)]
  }

  last(): number {
    return this.count > 0 ? this.values[this.slot(this.count - 1)] : 0
  }

  /** Samples oldest-first within [from, to). */
  samples(from = 0, to = this.count): { ticks: number[]; values: number[] } {
    const start = Math.max(0, Math.min(from, this.count))
    const end = Math.max(start, Math.min(to, this.count))
    const ticks: number[] = []
    const values: number[] = []
    for (let i = start; i < end; i++) {
      const k = this.slot(i)
      ticks.push(this.ticks[k])
      values.push(this.values[k])
    }
    return { ticks, values }
  }

  clear(): void {
    this.head = 0
    this.count = 0
  }
}