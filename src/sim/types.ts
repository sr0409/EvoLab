/**
 * Shared constants, small value types and enums for the simulation core.
 *
 * Plain constants (rather than TS enums) are used so the same numeric values can
 * be stored in typed arrays and serialised without runtime helpers.
 */

export type TerrainId = number

export const TERRAIN_DEEP_WATER = 0
export const TERRAIN_WATER = 1
export const TERRAIN_SHORE = 2
export const TERRAIN_SOIL = 3
export const TERRAIN_GRASS = 4
export const TERRAIN_SHRUB = 5
export const TERRAIN_FOREST = 6
export const TERRAIN_ROCK = 7
export const TERRAIN_COUNT = 8

export const TERRAIN_NAMES: readonly string[] = [
  'open ocean',
  'shallow water',
  'shore',
  'bare soil',
  'grassland',
  'scrubland',
  'forest',
  'highland rock'
]

/** Terrain that creatures can stand on (all but the two water classes). */
export function isLandTerrain(terrain: TerrainId): boolean {
  return terrain >= TERRAIN_SHORE
}

export function isImpassableTerrain(terrain: TerrainId): boolean {
  return terrain === TERRAIN_DEEP_WATER
}

/** Behaviour states. Numeric so they can live in typed arrays / hot loops. */
export const BEHAVIOR_WANDER = 0
export const BEHAVIOR_FORAGE = 1
export const BEHAVIOR_HUNT = 2
export const BEHAVIOR_FLEE = 3
export const BEHAVIOR_MATE = 4
export const BEHAVIOR_REST = 5
export const BEHAVIOR_COUNT = 6
export const BEHAVIOR_NAMES: readonly string[] = [
  'wandering',
  'foraging',
  'hunting',
  'fleeing',
  'seeking a mate',
  'resting'
]

export type DietClass = 'herbivore' | 'omnivore' | 'carnivore'
export const DIET_CLASSES: readonly DietClass[] = ['herbivore', 'omnivore', 'carnivore']

/** A diet gene of 0 is a strict herbivore, 1 a strict carnivore. */
export function dietClassOf(dietGene: number): DietClass {
  if (dietGene < 0.34) return 'herbivore'
  if (dietGene > 0.66) return 'carnivore'
  return 'omnivore'
}

export type DeathCause = 'old age' | 'starvation' | 'predation' | 'disease' | 'thermal stress' | 'conflict'

export const DEATH_CAUSES: readonly DeathCause[] = [
  'old age',
  'starvation',
  'predation',
  'disease',
  'thermal stress',
  'conflict'
]

export type EventKind =
  | 'speciation'
  | 'extinction'
  | 'population_crash'
  | 'population_boom'
  | 'food_collapse'
  | 'climate'
  | 'system'

export interface EventRecord {
  tick: number
  kind: EventKind
  message: string
  speciesId?: number
}

export interface TraitStat {
  mean: number
  min: number
  max: number
  sd: number
}

export interface Census {
  tick: number
  total: number
  byDiet: number[]
  bySpecies: number[]
  traits: TraitStat[]
  behaviourCounts: number[]
  totalBiomassEnergy: number
  totalDetritusEnergy: number
  avgTemperature: number
  births: number
  deaths: number
}

export interface Viewport {
  /** World-space coordinates of the top-left corner, in tiles. */
  x: number
  y: number
  /** Pixels per tile. */
  scale: number
  width: number
  height: number
}
