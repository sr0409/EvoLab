/**
 * The world: terrain, water, soil nutrients, vegetation, mineral resources and
 * climate.
 *
 * Everything is stored in typed arrays indexed as `y * width + x`. Terrain is
 * generated once from value noise; vegetation, detritus and soil fertility are
 * integrated every tick. The climate (seasons, latitude, altitude, the user's
 * climate anomaly) is a pure function of (x, y, tick, config), so a simulation
 * can be restored from a save file without ever storing weather.
 *
 * Energy accounting: plant growth is *gross primary production* and is added to
 * the engine's energy ledger; plant respiration and decomposition are losses.
 * All fluxes are clamped so that a pool can never go negative, which is what
 * makes "energy is conserved" testable to floating-point precision.
 */

import {
  TERRAIN_COUNT,
  TERRAIN_DEEP_WATER,
  TERRAIN_FOREST,
  TERRAIN_GRASS,
  TERRAIN_ROCK,
  TERRAIN_SHORE,
  TERRAIN_SHRUB,
  TERRAIN_SOIL,
  TERRAIN_WATER,
  type TerrainId
} from './types'
import type { EnvironmentConfig, WorldConfig } from './config'
import { Rng, hashSeed } from './rng'
import { clamp, fbm, hash2, radialFalloff, ridgedFbm, valueNoise } from './noise'

/** Fraction of a site's capacity that photosynthesis can fix per ideal tick. */
export const PLANT_GROWTH_BASE = 0.1
/** Fraction of standing plant biomass respired per tick. */
export const PLANT_RESPIRATION = 0.03
/** Fertility withdrawn from the soil per unit of energy fixed by photosynthesis. */
export const NUTRIENT_PER_GROSS = 0.05
/**
 * Share of the nutrients locked up in tissue that mineralises back into soil
 * fertility when that tissue is respired or decomposed; the rest is leached or
 * buried. Grazing moves nutrients with the tissue, and they come back as waste
 * and carcasses.
 */
export const NUTRIENT_YIELD = 0.85
/** Share of a tick's net primary production shed as litter (fine roots, leaves, dead wood). */
export const PLANT_LITTER_SHARE = 0.3
/** Background fertility supply per land tile per tick: rock weathering, fixation, deposition. */
export const NUTRIENT_INPUT = 0.004
/** Detritus pool ceiling, in energy units per tile. */
export const DETRITUS_MAX = 40
/** Mineral deposit ceiling per tile. */
export const MINERAL_MAX = 10
/** Rock weathering releases this many mineral units per tick. */
export const WEATHERING_RATE = 0.002
/** Season names, indexed by quarter of the year. */
export const SEASON_NAMES = ['high sun', 'declining light', 'deep winter', 'thaw'] as const

export interface EnvState {
  tick: number
  /** 0..1 position within the year. */
  phase: number
  /** 0..3 quarter index. */
  season: number
  seasonName: string
  /** Total climate anomaly currently applied (user anomaly + drift). */
  anomaly: number
  /** Seasonal temperature swing currently applied, in °C. */
  seasonalOffset: number
  /** Seasonal rainfall multiplier. */
  moistureFactor: number
  baseTemperature: number
  latitudeGradient: number
  plantOptimum: number
  plantTolerance: number
  decompositionRate: number
  sunlight: number
  rainfall: number
}

export interface EnergyFlux {
  /** Energy fixed by photosynthesis this tick. */
  grossPrimaryProduction: number
  /** Energy plants respire this tick. */
  autotrophicRespiration: number
  /** Detritus respired by decomposers this tick. */
  decomposition: number
  /** Detritus that could not be held by the soil (leaves the system). */
  buried: number
  /** Mean world temperature this tick, in °C. */
  temperatureMean: number
}

export class World {
  readonly width: number
  readonly height: number
  readonly size: number
  seaLevel: number

  /** Elevation 0..1. */
  elevation: Float32Array
  /** Soil moisture 0..1. */
  moisture: Float32Array
  /** Soil fertility 0..1. */
  fertility: Float32Array
  /** Standing plant biomass, in energy units per tile. */
  biomass: Float32Array
  /** Dead organic matter, in energy units per tile. */
  detritus: Float32Array
  /** Mineral nutrients available to grazers, per tile. */
  mineral: Float32Array
  /** Maximum plant energy a site can hold. */
  capacity: Float32Array
  /** Cached temperature per tile, refreshed every tick before the agents act. */
  temperature: Float32Array
  /** Derived terrain class, refreshed with refreshTerrain(). */
  terrain: Uint8Array

  terrainCounts = new Int32Array(TERRAIN_COUNT)

  /** Reused climate state (the engine reads it, it is never stored in saves). */
  readonly env: EnvState = {
    tick: 0,
    phase: 0,
    season: 0,
    seasonName: SEASON_NAMES[0],
    anomaly: 0,
    seasonalOffset: 0,
    moistureFactor: 1,
    baseTemperature: 20,
    latitudeGradient: 1,
    plantOptimum: 20,
    plantTolerance: 10,
    decompositionRate: 0.05,
    sunlight: 1,
    rainfall: 1
  }

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
    this.size = width * height
    this.seaLevel = 0.34
    this.elevation = new Float32Array(this.size)
    this.moisture = new Float32Array(this.size)
    this.fertility = new Float32Array(this.size)
    this.biomass = new Float32Array(this.size)
    this.detritus = new Float32Array(this.size)
    this.mineral = new Float32Array(this.size)
    this.capacity = new Float32Array(this.size)
    this.temperature = new Float32Array(this.size)
    this.terrain = new Uint8Array(this.size)
  }

  index(x: number, y: number): number {
    return y * this.width + x
  }

  xOf(index: number): number {
    return index % this.width
  }

  yOf(index: number): number {
    return Math.floor(index / this.width)
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height
  }

  isWater(index: number): boolean {
    return this.elevation[index] < this.seaLevel
  }

  isDeepWater(index: number): boolean {
    return this.elevation[index] < this.seaLevel - 0.1
  }

  /** Procedural terrain: continental base + ridged mountains + island falloff. */
  generate(config: WorldConfig): void {
    const { width, height, size } = this
    const s = hashSeed(`world:${config.seed}`)
    this.seaLevel = config.seaLevel
    const mountain = config.mountaininess
    const wetness = config.wetness

    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const continental = fbm(x * 0.9, y * 0.9, s + 11, { octaves: 4, baseScale: Math.max(40, width * 0.9) })
        const ridge = ridgedFbm(x, y, s + 29, 4, Math.max(18, width * 0.24))
        const detail = fbm(x, y, s + 53, { octaves: 5, baseScale: 26 })
        const falloff = radialFalloff(x, y, width / 2, height / 2, Math.min(width, height) * 0.62)
        const e = 0.16 + 0.5 * continental + 0.42 * mountain * ridge + 0.1 * detail - 0.55 * (1 - falloff)
        this.elevation[i] = clamp(e, 0, 1)
      }
    }

    const sea = this.seaLevel
    const land = new Uint8Array(size)
    for (let i = 0; i < size; i++) land[i] = this.elevation[i] >= sea ? 1 : 0

    // Soil moisture: wetness-scaled noise, boosted near coasts, dried on high ground.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        const base = fbm(x, y, s + 71, { octaves: 4, baseScale: Math.max(30, width * 0.5) })
        const alt = Math.max(0, (this.elevation[i] - sea) / Math.max(0.05, 1 - sea))
        this.moisture[i] = clamp((0.1 + 0.9 * base) * (0.35 + 0.75 * wetness) * (1 - 0.55 * alt), 0, 1)
      }
    }
    // Two dilation passes so coastlines, estuaries and islands are wet.
    const coastal = new Float32Array(size)
    for (let pass = 0; pass < 2; pass++) {
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          const i = y * width + x
          if (!land[i]) continue
          let near = 0
          for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue
              const nx = x + dx
              const ny = y + dy
              if (!this.inBounds(nx, ny)) {
                near += 1
                continue
              }
              const j = ny * width + nx
              if (!land[j]) near += 1
              else near += coastal[j] * 0.45
            }
          }
          const next = clamp(near / 8, 0, 1)
          coastal[i] = Math.max(coastal[i], next)
        }
      }
    }
    for (let i = 0; i < size; i++) {
      if (land[i]) this.moisture[i] = clamp(this.moisture[i] + 0.5 * coastal[i], 0, 1)
    }

    // Soil fertility (sediment settles to low ground) and site capacity.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (!land[i]) {
          this.fertility[i] = 0
          this.capacity[i] = 0
          continue
        }
        const alt = Math.max(0, (this.elevation[i] - sea) / Math.max(0.05, 1 - sea))
        const coarse = valueNoise(x, y, 96, s + 131)
        const fine = fbm(x, y, s + 131, { octaves: 3, baseScale: 38 })
        const f = clamp((0.35 * coarse + 0.65 * fine) * (1 - 0.35 * alt), 0, 1)
        this.fertility[i] = f
        const productivity = (0.2 + 0.8 * this.moisture[i]) * (0.3 + 0.7 * f) * (1 - 0.5 * alt)
        this.capacity[i] = clamp(2 + 34 * productivity, 0, 40)
      }
    }

    // Mineral deposits: rare, concentrated in high, steep country.
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = y * width + x
        if (!land[i]) {
          this.mineral[i] = 0
          continue
        }
        const alt = Math.max(0, (this.elevation[i] - sea) / Math.max(0.05, 1 - sea))
        const steep = Math.abs(this.elevation[Math.min(size - 1, i + 1)] - this.elevation[Math.max(0, i - 1)])
        const threshold = 0.985 - 0.12 * alt - 0.3 * steep
        this.mineral[i] = hash2(x, y, s + 911) > threshold ? MINERAL_MAX * (0.4 + 0.6 * hash2(x, y, s + 1571)) : 0
      }
    }

    // Pre-seed vegetation so a fresh world is immediately habitable.
    for (let i = 0; i < size; i++) {
      this.biomass[i] = land[i] ? this.capacity[i] * 0.5 : 0
      this.detritus[i] = 0
    }
    this.refreshTerrain()
  }

  /** Classify every tile from elevation + standing vegetation; refresh coverage counts. */
  refreshTerrain(): void {
    const { size, seaLevel } = this
    const counts = this.terrainCounts
    counts.fill(0)
    for (let i = 0; i < size; i++) {
      const e = this.elevation[i]
      let t: TerrainId
      if (e < seaLevel - 0.06) t = TERRAIN_DEEP_WATER
      else if (e < seaLevel) t = TERRAIN_WATER
      else if (e < seaLevel + 0.035) t = TERRAIN_SHORE
      else {
        const alt = (e - seaLevel) / Math.max(0.05, 1 - seaLevel)
        if (alt > 0.74) t = TERRAIN_ROCK
        else {
          const cap = this.capacity[i] > 0 ? this.capacity[i] : 1
          const ratio = this.biomass[i] / cap
          if (ratio > 0.62) t = TERRAIN_FOREST
          else if (ratio > 0.34) t = TERRAIN_SHRUB
          else if (ratio > 0.1) t = TERRAIN_GRASS
          else t = TERRAIN_SOIL
        }
      }
      this.terrain[i] = t
      counts[t]++
    }
  }

  /**
   * Climate state for a tick. Kept as one reused object so the hot loop does not
   * allocate; per-tile temperature is cached separately by `stepVegetation`.
   */
  updateEnvironment(config: EnvironmentConfig, tick: number): EnvState {
    const env = this.env
    const year = Math.max(60, config.yearLength)
    const phase = (tick % year) / year
    env.tick = tick
    env.phase = phase
    env.season = Math.floor(((phase + 0.125) % 1) * 4) % 4
    env.seasonName = SEASON_NAMES[env.season]
    env.anomaly = config.temperatureAnomaly + config.climateDriftPerTick * tick
    env.seasonalOffset = config.seasonalAmplitude * Math.cos(2 * Math.PI * phase)
    const wetSwing = 0.15 + 0.03 * config.seasonalAmplitude
    env.moistureFactor = Math.max(0.05, 1 + wetSwing * Math.sin(2 * Math.PI * (phase - 0.15)))
    env.baseTemperature = config.baseTemperature
    env.latitudeGradient = config.latitudeGradient
    env.plantOptimum = config.plantThermalOptimum
    env.plantTolerance = Math.max(1, config.plantThermalTolerance)
    env.decompositionRate = config.decompositionRate
    env.sunlight = config.sunlight
    env.rainfall = config.rainfall
    return env
  }

  /**
   * Temperature at a point, in °C: an equator-to-pole profile plus an altitudinal
   * lapse rate, the seasonal swing (stronger towards the poles) and any anomaly.
   * Calibrated so `baseTemperature` is the tropical mean and the poles sit roughly
   * 38 °C colder at latitudeGradient = 1.
   */
  private temperatureAt(env: EnvState, x: number, y: number): number {
    const lat = Math.min(1, Math.abs(y - this.height * 0.5) / (this.height * 0.5))
    const i = y * this.width + x
    const alt = Math.max(0, (this.elevation[i] - this.seaLevel) / Math.max(0.05, 1 - this.seaLevel))
    const latitude = env.latitudeGradient * 38 * Math.pow(lat, 1.6)
    const altitude = 22 * Math.pow(alt, 1.15)
    const seasonal = env.seasonalOffset * (0.35 + 0.7 * lat)
    return env.baseTemperature + env.anomaly - latitude - altitude + seasonal
  }

  /**
   * One tick of photosynthesis, litter, plant respiration, decomposition and
   * weathering. Also refreshes the per-tile temperature cache the agents read.
   *
   * Soil fertility is a closed cycle: photosynthesis withdraws nutrients, litter
   * hands them to the detritus pool, respiration and decomposition put them back
   * in the soil, and grazing moves them into animals, which give them back as
   * waste and carcasses (see `releaseNutrients`). Weathering is the only new
   * input, so heavily grazed ground recovers over seasons instead of instantly.
   */
  stepVegetation(env: EnvState, flux: EnergyFlux): void {
    const { size, seaLevel, width } = this
    flux.grossPrimaryProduction = 0
    flux.autotrophicRespiration = 0
    flux.decomposition = 0
    flux.buried = 0
    let temperatureSum = 0

    for (let i = 0; i < size; i++) {
      const x = i % width
      const y = (i / width) | 0
      const temp = this.temperatureAt(env, x, y)
      this.temperature[i] = temp
      temperatureSum += temp

      // Decomposition and weathering happen everywhere, water included; only land
      // soils keep the nutrients they release.
      let soil = this.capacity[i] > 0 ? this.fertility[i] : 0
      const detritus = this.detritus[i]
      if (detritus > 0) {
        const dec = detritus * env.decompositionRate
        this.detritus[i] = detritus - dec
        flux.decomposition += dec
        soil += dec * NUTRIENT_PER_GROSS * NUTRIENT_YIELD
      }
      if (this.elevation[i] >= seaLevel) {
        const alt = Math.max(0, (this.elevation[i] - seaLevel) / Math.max(0.05, 1 - seaLevel))
        const m = this.mineral[i] + WEATHERING_RATE * (1 + 3 * alt)
        this.mineral[i] = m > MINERAL_MAX ? MINERAL_MAX : m
        soil += NUTRIENT_INPUT
      }

      const cap = this.capacity[i]
      if (cap <= 0) {
        if (this.biomass[i] !== 0) this.biomass[i] = 0
        if (this.fertility[i] !== 0) this.fertility[i] = 0
        continue
      }
      const b = this.biomass[i]
      const dT = (temp - env.plantOptimum) / env.plantTolerance
      const tempSuit = 1 / (1 + dT * dT)
      const wetSuit = Math.min(1, this.moisture[i] * env.moistureFactor * env.rainfall)
      const nutrientSuit = 0.2 + 0.8 * soil
      let gross = cap * PLANT_GROWTH_BASE * env.sunlight * tempSuit * wetSuit * nutrientSuit * (1 - b / cap)
      if (gross < 0) gross = 0
      // A tile can only fix what its soil can pay for this tick.
      const nutrientBudget = soil / NUTRIENT_PER_GROSS
      if (gross > nutrientBudget) gross = nutrientBudget
      if (gross > cap - b) gross = cap - b
      let resp = b * PLANT_RESPIRATION * (1 + 0.02 * Math.max(0, temp - env.plantOptimum))
      if (resp > b) resp = b
      // Whatever is not respired either stays standing or is shed as litter.
      const litter = gross * PLANT_LITTER_SHARE
      this.biomass[i] = b + gross - resp - litter
      // Litter that overflows the soil's holding capacity is buried: it leaves the
      // cycle, and the nutrients it carried with it are lost to geology too.
      const overflow = this.depositDetritus(i, litter)
      flux.buried += overflow
      if (overflow > 0) soil -= overflow * NUTRIENT_PER_GROSS
      // Photosynthesis pays for the nutrients it takes up; the tissue respired this
      // tick gives most of them straight back, and the litter gives up its share as
      // it decomposes.
      soil -= gross * NUTRIENT_PER_GROSS
      soil += resp * NUTRIENT_PER_GROSS * NUTRIENT_YIELD
      this.fertility[i] = soil < 0 ? 0 : soil > 1 ? 1 : soil
      flux.grossPrimaryProduction += gross
      flux.autotrophicRespiration += resp
    }
    flux.temperatureMean = size > 0 ? temperatureSum / size : 0
  }

  /** Remove up to `amount` energy of vegetation from a tile. Returns what was eaten. */
  graze(index: number, amount: number): number {
    const b = this.biomass[index]
    if (b <= 0 || amount <= 0) return 0
    const eaten = b < amount ? b : amount
    this.biomass[index] = b - eaten
    return eaten
  }

  /**
   * Add carcass / faecal energy to the soil. Returns the amount that could not be
   * held; the engine reports that to the ledger as buried, i.e. lost from the
   * system.
   */
  depositDetritus(index: number, amount: number): number {
    if (amount <= 0) return 0
    const current = this.detritus[index]
    const space = DETRITUS_MAX - current
    if (space <= 0) return amount
    if (amount <= space) {
      this.detritus[index] = current + amount
      return 0
    }
    this.detritus[index] = DETRITUS_MAX
    return amount - space
  }

  /** Take up to `amount` mineral units from a tile. Returns what was taken. */
  takeMineral(index: number, amount: number): number {
    const m = this.mineral[index]
    if (m <= 0 || amount <= 0) return 0
    const taken = m < amount ? m : amount
    this.mineral[index] = m - taken
    return taken
  }

  /**
   * Mineralise the nutrients carried by `amount` units of metabolised or dead
   * organic matter into the soil at `index`. Sea tiles hold no soil, so there the
   * nutrients are simply lost to the water. The engine calls this when an animal
   * burns tissue, which is what closes the cycle photosynthesis opens.
   */
  releaseNutrients(index: number, amount: number): void {
    if (amount <= 0 || this.capacity[index] <= 0) return
    const f = this.fertility[index] + amount * NUTRIENT_PER_GROSS * NUTRIENT_YIELD
    this.fertility[index] = f > 1 ? 1 : f
  }

  totalBiomass(): number {
    let sum = 0
    for (let i = 0; i < this.size; i++) sum += this.biomass[i]
    return sum
  }

  totalDetritus(): number {
    let sum = 0
    for (let i = 0; i < this.size; i++) sum += this.detritus[i]
    return sum
  }

  totalMineral(): number {
    let sum = 0
    for (let i = 0; i < this.size; i++) sum += this.mineral[i]
    return sum
  }

  landTiles(): number {
    let sum = 0
    for (let i = 0; i < this.size; i++) if (this.elevation[i] >= this.seaLevel) sum++
    return sum
  }

  /** A deterministic habitable tile for placing an organism. */
  findSpawn(rng: Rng): number {
    for (let attempt = 0; attempt < 400; attempt++) {
      const i = rng.int(this.size)
      if (this.elevation[i] >= this.seaLevel + 0.04 && this.capacity[i] > 4) return i
    }
    for (let i = 0; i < this.size; i++) if (this.capacity[i] > 0) return i
    return this.size >> 1
  }
}
