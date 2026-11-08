/**
 * Simulation configuration: world generation, environment, evolution and
 * population knobs, plus a handful of curated scenarios the UI can apply.
 *
 * Everything here is data. Environmental pressures the user can change (climate,
 * rainfall, sunlight, mutation rate, speciation threshold) all live in this one
 * object, and the engine reads it every tick so changes take effect live.
 */

import { DIET_CLASSES, type DietClass } from './types'

export interface WorldConfig {
  width: number
  height: number
  /** Seed used for terrain as well as creature randomness (derived separately). */
  seed: string
  mountaininess: number
  wetness: number
  seaLevel: number
}

export interface EnvironmentConfig {
  /** Mean temperature at the equator, in °C. */
  baseTemperature: number
  /** User-controlled climate anomaly, in °C. */
  temperatureAnomaly: number
  /** Slow linear climate trend applied every tick, in °C per tick. */
  climateDriftPerTick: number
  /** Peak seasonal swing at the poles, in °C. */
  seasonalAmplitude: number
  /** Length of a year in ticks. */
  yearLength: number
  /** Rainfall multiplier applied to plant growth. */
  rainfall: number
  /** Global photosynthesis multiplier (effective productivity). */
  sunlight: number
  /** How strongly temperature falls off towards the poles. */
  latitudeGradient: number
  /** Width of the plant-growth suitability curve, °C. */
  plantThermalTolerance: number
  /** Optimal plant temperature, °C. */
  plantThermalOptimum: number
  /** Rate at which detritus decomposes back into soil nutrients. */
  decompositionRate: number
}

export interface EvolutionConfig {
  /** Base per-trait mutation probability at birth. */
  mutationRate: number
  /** Multiplier on mutation magnitude. */
  mutationStrength: number
  /** Genome distance above which a newborn is assigned to a new species. */
  speciationThreshold: number
  /** If true, offspring are blocked from breeding with close relatives. */
  avoidInbreeding: boolean
}

export interface PopulationConfig {
  /** Founder counts per diet archetype. */
  founders: Record<DietClass, number>
  /** Hard ceiling on living creatures (a modelling limit, not biology; clamped to 4000). */
  maxCreatures: number
}

export interface SimConfig {
  world: WorldConfig
  environment: EnvironmentConfig
  evolution: EvolutionConfig
  population: PopulationConfig
}

export function defaultConfig(): SimConfig {
  return {
    world: {
      width: 168,
      height: 112,
      seed: 'evolab',
      mountaininess: 0.35,
      wetness: 0.6,
      seaLevel: 0.34
    },
    environment: {
      baseTemperature: 26,
      temperatureAnomaly: 0,
      climateDriftPerTick: 0,
      seasonalAmplitude: 9,
      yearLength: 600,
      rainfall: 1,
      sunlight: 1,
      latitudeGradient: 1,
      plantThermalTolerance: 11,
      plantThermalOptimum: 22,
      decompositionRate: 0.06
    },
    evolution: {
      mutationRate: 0.05,
      mutationStrength: 1,
      speciationThreshold: 0.1,
      avoidInbreeding: true
    },
    population: {
      // Measured founder load (PROGRESS.md §6D, candidate h). 60/18/12 overharvests
      // its own founding herd: with carnivores seeded inside it, 12 strict
      // meat-eaters harvest the founders faster than the first young reach
      // maturityAge, and the whole world collapses on some seeds. 120/18/6 is the
      // ratio those measurements found that survives every seed tested and keeps a
      // carnivore population standing.
      founders: { herbivore: 120, omnivore: 18, carnivore: 6 },
      maxCreatures: 3200
    }
  }
}

export interface Scenario {
  id: string
  label: string
  description: string
  patch: { environment?: Partial<EnvironmentConfig>; evolution?: Partial<EvolutionConfig> }
}

/** Curated environmental pressures the UI can apply at the click of a button. */
export const SCENARIOS: readonly Scenario[] = [
  {
    id: 'temperate',
    label: 'Temperate baseline',
    description: 'The default climate: mild seasons, reliable rain, a stable biosphere.',
    patch: {}
  },
  {
    id: 'greenhouse',
    label: 'Greenhouse shift',
    description: 'A warming world (+6 °C with a continuing trend). Tests thermal adaptation and range shifts.',
    patch: { environment: { temperatureAnomaly: 6, climateDriftPerTick: 0.004, seasonalAmplitude: 12 } }
  },
  {
    id: 'ice-age',
    label: 'Ice age',
    description: 'Cold and brutal. Selects for thermal tolerance, low metabolism and fat reserves.',
    patch: {
      environment: { baseTemperature: 2, seasonalAmplitude: 22, rainfall: 0.7, plantThermalOptimum: 8 }
    }
  },
  {
    id: 'monsoon',
    label: 'Monsoon pulses',
    description: 'Rain arrives in one violent season, so food becomes a boom-and-bust resource.',
    patch: { environment: { rainfall: 1.35, seasonalAmplitude: 14, yearLength: 320 } }
  },
  {
    id: 'famine',
    label: 'Famine',
    description: 'A thin, unproductive biosphere. Population crashes and resource competition bite hard.',
    patch: { environment: { sunlight: 0.42, rainfall: 0.62 } }
  },
  {
    id: 'mutagenic',
    label: 'Mutagenic radiation',
    description: 'Heavy mutation load: rapid divergence, frequent new lineages, many maladapted young.',
    patch: { evolution: { mutationRate: 0.22, mutationStrength: 1.6, speciationThreshold: 0.08 } }
  }
]

export function findScenario(id: string): Scenario | undefined {
  return SCENARIOS.find((s) => s.id === id)
}

export function applyScenario(config: SimConfig, scenario: Scenario): void {
  const fresh = defaultConfig()
  Object.assign(config.environment, fresh.environment)
  Object.assign(config.evolution, fresh.evolution)
  if (scenario.patch.environment) Object.assign(config.environment, scenario.patch.environment)
  if (scenario.patch.evolution) Object.assign(config.evolution, scenario.patch.evolution)
  normalizeConfig(config)
}

/** Validate & clamp user input so a stray slider value cannot break the sim. */
export function normalizeConfig(config: SimConfig): void {
  const w = config.world
  w.width = Math.max(24, Math.min(420, Math.round(w.width)))
  w.height = Math.max(24, Math.min(420, Math.round(w.height)))
  w.mountaininess = clampNum(w.mountaininess, 0, 1)
  w.wetness = clampNum(w.wetness, 0.05, 1)
  w.seaLevel = clampNum(w.seaLevel, 0.05, 0.75)
  const e = config.environment
  e.baseTemperature = clampNum(e.baseTemperature, -20, 45)
  e.temperatureAnomaly = clampNum(e.temperatureAnomaly, -25, 25)
  e.climateDriftPerTick = clampNum(e.climateDriftPerTick, -0.02, 0.02)
  e.seasonalAmplitude = clampNum(e.seasonalAmplitude, 0, 40)
  e.yearLength = Math.max(60, Math.min(4000, Math.round(e.yearLength)))
  e.rainfall = clampNum(e.rainfall, 0.05, 2.5)
  e.sunlight = clampNum(e.sunlight, 0.05, 2.5)
  e.latitudeGradient = clampNum(e.latitudeGradient, 0, 2.5)
  e.plantThermalTolerance = clampNum(e.plantThermalTolerance, 2, 40)
  e.plantThermalOptimum = clampNum(e.plantThermalOptimum, -20, 45)
  e.decompositionRate = clampNum(e.decompositionRate, 0.001, 0.5)
  const v = config.evolution
  v.mutationRate = clampNum(v.mutationRate, 0, 0.9)
  v.mutationStrength = clampNum(v.mutationStrength, 0, 4)
  v.speciationThreshold = clampNum(v.speciationThreshold, 0.01, 0.6)
  const p = config.population
  // Hard design limit: an EvoLab world runs at most a few thousand animals.
  p.maxCreatures = Math.max(20, Math.min(4000, Math.round(p.maxCreatures)))
  for (const diet of DIET_CLASSES) {
    const requested = p.founders[diet] ?? 0
    p.founders[diet] = Math.max(0, Math.min(4000, Math.round(requested)))
  }
}

function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return v < min ? min : v > max ? max : v
}
