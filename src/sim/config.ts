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

export interface PredationConfig {
  /**
   * The energy floor a creature must hold to be legal quarry: the engine's
   * `prey.energy > 0.2` gate, exposed as a knob (PROGRESS.md §6E asks how
   * thinned prey bodies sit against it at equilibrium). The engine re-reads it
   * every tick, so the control takes effect on a live world. Default 0.2 is
   * the engine's own value: a world with the knob untouched behaves exactly
   * as before.
   */
  minPreyEnergy: number
  /**
   * What fraction of a prey's held body energy this predator's gut takes on a
   * kill: the engine pays `assimilationBase · (1 + digest)`, so the original
   * hard-coded `0.45 + 0.45 · digest` is exactly this value at its default
   * 0.45. The engine re-reads it every tick, so the control takes effect on a
   * live world. Default 0.45 is the engine's own constant: a world with the
   * knob untouched behaves exactly as it did before.
   */
  assimilationBase: number
}

export interface PopulationConfig {
  /** Founder counts per diet archetype. */
  founders: Record<DietClass, number>
  /**
   * Hard ceiling on living creatures (a modelling limit, not biology). The engine
   * reads it every tick and the UI can change it at any time with
   * `setPopulationCap`, so it takes effect on a running world without a restart:
   * breeding stops at the ceiling, and a population already above a lowered
   * ceiling falls back under it through ordinary deaths rather than a cull.
   */
  maxCreatures: number
}

/** Bounds the ceiling can be set to. A world smaller than this cannot hold a viable ecosystem. */
export const POPULATION_CAP_LIMITS = { min: 20, max: 4000 } as const

/**
 * Bounds the prey-energy floor can be set to. 0.2 is the engine's own gate and
 * reproduces every recorded measurement unchanged. The kill path separately
 * demands energy ≥ 0.4 (findQuarry), so values between 0.4 and 0.9 turn the
 * gate from "anything even alive" into "reasonably-fed quarry" — which is the
 * experiment PROGRESS.md §6E asks for.
 */
export const MIN_PREY_ENERGY_LIMITS = { min: 0, max: 0.9 } as const

/**
 * Bounds the gut constant can be set to. 0.45 reproduces the engine's original
 * `0.45 + 0.45 · digest` payout on every kill, and 0.9 keeps the widest digest
 * (1.0) at a total rate of 1.9 — still paid out of the prey's held energy, so
 * the ledger closes the same way.
 */
export const ASSIMILATION_BASE_LIMITS = { min: 0, max: 0.9 } as const

export interface SimConfig {
  world: WorldConfig
  environment: EnvironmentConfig
  evolution: EvolutionConfig
  predation: PredationConfig
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
    predation: {
      // The engine's own quarry gate (engine.ts `findQuarry`): a creature is
      // legal prey only while its energy reserve sits above this floor. 0.2 is
      // the value every recorded measurement (PROGRESS.md §6E–§6B) was made
      // against, so the knob stays inert unless the user moves it.
      minPreyEnergy: 0.2,
      // The engine's own gut constant (see `PredationConfig`): 0.45 pays the
      // `0.45 + 0.45 · digest` every measured kill used, and is likewise inert
      // unless the user moves it.
      assimilationBase: 0.45
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

/**
 * Set the population ceiling on a live configuration (the UI's manual control).
 * Values are rounded and kept inside POPULATION_CAP_LIMITS. Returns the ceiling
 * actually applied, so the UI can show what the simulation is really using.
 */
export function setPopulationCap(config: SimConfig, value: number): number {
  config.population.maxCreatures = clampPopulationCap(value)
  return config.population.maxCreatures
}

export function clampPopulationCap(value: number): number {
  // Hard design limit: an EvoLab world runs at most a few thousand animals.
  return Math.max(
    POPULATION_CAP_LIMITS.min,
    Math.min(POPULATION_CAP_LIMITS.max, Math.round(clampNum(value, POPULATION_CAP_LIMITS.min, POPULATION_CAP_LIMITS.max)))
  )
}

/**
 * Set the live quarry-energy floor (config.predation.minPreyEnergy): the
 * engine's `prey.energy > 0.2` predation gate exposed as a knob — the
 * experiment PROGRESS.md §6E leaves open. Returns the value actually applied.
 */
export function setMinPreyEnergy(config: SimConfig, value: number): number {
  config.predation.minPreyEnergy = clampMinPreyEnergy(value)
  return config.predation.minPreyEnergy
}

export function clampMinPreyEnergy(value: number): number {
  return clampNum(value, MIN_PREY_ENERGY_LIMITS.min, MIN_PREY_ENERGY_LIMITS.max)
}

/**
 * Set the live gut constant (`config.predation.assimilationBase`): the share of
 * a kill's held energy the predator actually absorbs, scaled by the predator's
 * `digest` trait. The engine's original payout was `0.45 + 0.45 · digest`, which
 * is exactly this knob at its default 0.45. Takes effect on a live world.
 * Returns the value actually applied.
 */
export function setAssimilationBase(config: SimConfig, value: number): number {
  config.predation.assimilationBase = clampAssimilationBase(value)
  return config.predation.assimilationBase
}

export function clampAssimilationBase(value: number): number {
  return clampNum(value, ASSIMILATION_BASE_LIMITS.min, ASSIMILATION_BASE_LIMITS.max)
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
  // Snapshots saved before the quarry-floor knob existed lack the section;
  // fill in the engine's own gate so old snapshots keep behaving exactly as
  // they were measured.
  const pd = (config.predation ??= { minPreyEnergy: 0.2, assimilationBase: 0.45 })
  pd.minPreyEnergy = clampMinPreyEnergy(pd.minPreyEnergy)
  pd.assimilationBase = clampAssimilationBase(pd.assimilationBase ?? 0.45)
  const p = config.population
  p.maxCreatures = clampPopulationCap(p.maxCreatures)
  for (const diet of DIET_CLASSES) {
    const requested = p.founders[diet] ?? 0
    p.founders[diet] = Math.max(0, Math.min(4000, Math.round(requested)))
  }
}

function clampNum(v: number, min: number, max: number): number {
  if (!Number.isFinite(v)) return min
  return v < min ? min : v > max ? max : v
}
