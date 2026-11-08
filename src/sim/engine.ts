/**
 * The simulation engine.
 *
 * Owns the world, population, species registry, lineage, energy ledger and the
 * census history. `tick()` advances exactly one fixed-timestep update:
 *
 *   1. environment + vegetation (photosynthesis, decomposition, weathering)
 *   2. agent updates in ascending id order (movement, feeding, predation,
 *      reproduction) — births are deferred and appended after the sweep, deaths
 *      are marked and compacted at the end of the tick
 *   3. periodic census, speciation/extinction bookkeeping, chart sampling
 *
 * Determinism: a single RNG stream drives every agent decision, the iteration
 * order is the creature id order, and all pools are bounded below by zero, so
 * the same seed and configuration always produce the same run.
 *
 * Energy accounting: every flux that crosses the boundary of the living system
 * (photosynthesis, plant respiration, decomposition, burial) is recorded in an
 * `EnergyLedger`; internal transfers (feeding, excretion, predation, carcasses,
 * parental investment) are conserved by construction. `auditEnergy()` proves the
 * identity  biomass + detritus + creature energy
 *              = initial + photosynthesis − plant respiration
 *                        − decomposition − burial − metabolism/movement heat.
 */

import {
  BEHAVIOR_FLEE,
  BEHAVIOR_FORAGE,
  BEHAVIOR_HUNT,
  BEHAVIOR_MATE,
  BEHAVIOR_REST,
  BEHAVIOR_WANDER
} from './types'
import { DIET_CLASSES, type DeathCause, type EventKind, type EventRecord } from './types'
import type { SimConfig } from './config'
import { Rng } from './rng'
import { World, type EnergyFlux } from './world'
import { Species } from './species'
import { LineageStore } from './lineage'
import { SpatialGrid } from './spatial'
import { computeCensus, SeriesBuffer, type CensusField, type CensusRecord } from './stats'
import {
  TRAIT_COUNT,
  TRAIT_INDEX,
  buildPhenotype,
  cloneGenome,
  founderGenome,
  inherit,
  mutate,
  newGenome,
  type Genome,
  type Phenotype
} from './traits'
import type { RngState } from './rng'
import { clamp } from './noise'

/** A living (or just-dead) creature. Positions are world tile coordinates. */
export interface Creature {
  id: number
  speciesId: number
  x: number
  y: number
  /** Movement target tile. */
  tx: number
  ty: number
  energy: number
  /** Energy ceiling from the phenotype, cached for cheap census reads. */
  maxEnergy: number
  health: number
  age: number
  minerals: number
  behavior: number
  reproCooldown: number
  offspringCount: number
  kills: number
  birthTick: number
  localTemperature: number
  phenotype: Phenotype
  genome: Genome
  alive: boolean
  /** Creature id of the quarry this animal is chasing, or -1. Transient
   *  behaviour state like `tx`/`ty`; not persisted in saves. */
  huntTarget: number
  /** Pending birth marker; only lives in the newborn buffer during a tick. */
  pending?: boolean
}

/** Cumulative boundary fluxes of the living system, in energy units. */
export interface EnergyLedger {
  /** biomass + detritus + creature energy right after world generation. */
  initial: number
  /** Energy fixed by photosynthesis. */
  photosynthesis: number
  /** Energy plants respire. */
  plantRespiration: number
  /** Energy lost to soil (detritus respired by decomposers). */
  decomposition: number
  /** Energy lost to geology (carcass/waste the soil could not hold). */
  burial: number
  /** Residual: metabolism, movement and thermoregulation heat. */
  lifeHeat: number
}

export interface EnergyAudit {
  biomass: number
  detritus: number
  creatures: number
  total: number
  expected: number
  delta: number
}

export interface SimEvent extends EventRecord {
  seq: number
}

export interface CreatureSave {
  ids: Int32Array
  speciesIds: Int32Array
  x: Float32Array
  y: Float32Array
  energy: Float32Array
  maxEnergy: Float32Array
  health: Float32Array
  age: Int32Array
  minerals: Float32Array
  behavior: Int32Array
  reproCooldown: Int32Array
  offspringCount: Int32Array
  kills: Int32Array
  birthTick: Int32Array
  genomes: Float32Array
}

/** Plain-data snapshot of a whole simulation, ready for JSON serialisation. */
export interface SimulationState {
  version: number
  config: SimConfig
  tick: number
  nextId: number
  rngState: RngState
  rngSeed: number
  ledger: EnergyLedger
  worldElevation: Float32Array
  worldMoisture: Float32Array
  worldFertility: Float32Array
  worldCapacity: Float32Array
  worldBiomass: Float32Array
  worldDetritus: Float32Array
  worldMineral: Float32Array
  creatures: CreatureSave
  species: ReturnType<Species['snapshot']>
  lineage: ReturnType<LineageStore['snapshot']>
}

export const SIM_STATE_VERSION = 1

const CENSUS_PERIOD = 5
const TERRAIN_REFRESH_PERIOD = 10
/**
 * Flight-initiation distance, in tiles. A prey animal commits to a full-speed
 * sprint only when a predator is this close; fleeing at max speed from an
 * animal that is still far away costs more energy than it saves, and gave
 * every hunter a ~25-tick closing run it could not afford (see the food-web
 * probe in tests/scratch.test.ts).
 */
const FLEE_INITIATION_DISTANCE = 3
const MAX_EVENTS = 500
/** Below this many creatures, boom/crash alerts are not raised. */
const EVENT_POP_THRESHOLD = 20
/** Census fields sampled into chart series. */
export const CHART_FIELDS: readonly CensusField[] = [
  'population',
  'speciesAlive',
  'temperature',
  'biomass',
  'meanFitness',
  'meanThermalOptimum',
  'thermalMismatch'
]

export class Simulation {
  readonly config: SimConfig
  readonly world: World
  readonly species: Species
  readonly lineage: LineageStore
  ledger: EnergyLedger = {
    initial: 0,
    photosynthesis: 0,
    plantRespiration: 0,
    decomposition: 0,
    burial: 0,
    lifeHeat: 0
  }

  creatures: Creature[] = []

  tick = 0
  nextId = 0

  readonly events: SimEvent[] = []
  /** Events are trimmed at MAX_EVENTS; earlier cursors shift by this amount. */
  eventBase = 0
  private eventSeq = 0

  lastCensus: CensusRecord | null = null

  /** Deaths by cause, cumulative since the run began. */
  readonly deathsByCause: Record<DeathCause, number> = {
    'old age': 0,
    starvation: 0,
    disease: 0,
    predation: 0,
    'thermal stress': 0,
    conflict: 0
  }

  /** Chart series, sampled at every census. */
  private readonly series = new Map<CensusField, SeriesBuffer>()

  private readonly rng: Rng
  private readonly grid: SpatialGrid
  private readonly flux: EnergyFlux = {
    grossPrimaryProduction: 0,
    autotrophicRespiration: 0,
    decomposition: 0,
    buried: 0,
    temperatureMean: 0
  }
  /** Coarse maximum-biomass-per-cell map used by foraging decisions. */
  private cellFood: Float64Array
  private neighborBuf: Int32Array
  private prevSpeciesCounts: Int32Array = new Int32Array(0)
  private birthsSinceCensus = 0
  private deathsSinceCensus = 0
  private newborns: Creature[] = []

  constructor(config: SimConfig) {
    this.config = config
    this.world = new World(config.world.width, config.world.height)
    this.rng = new Rng(`${config.world.seed}#agents`)
    this.species = new Species(this.rng)
    this.lineage = new LineageStore()
    this.grid = new SpatialGrid(this.world.width, this.world.height, 6)
    this.cellFood = new Float64Array(this.grid.cellCount)
    this.neighborBuf = new Int32Array(256)
    for (const field of CHART_FIELDS) this.series.set(field, new SeriesBuffer())

    this.world.generate(config.world)
    // Founder rings around one fertile core. Producers settle the core; each
    // carnivore is seeded inside the producer herd instead of on a wider ring.
    // The measurements (PROGRESS.md §6D) found the binding constraint at t = 0
    // was distance, not price: a founder band starved with its nearest legal
    // quarry 6.6–8.7 tiles away — beyond the distance its own pursuit rule
    // would ever start a hunt for. Seeding each hunter within a stride of a
    // producer removes exactly that distance: the strike gate (speed + 0.6)
    // covers the spawn gap, so the founder herd is huntable from the first
    // hunger cycle and the producers still establish on the core first.
    const core = this.world.findSpawn(this.rng)
    const founderRing: Record<'herbivore' | 'omnivore' | 'carnivore', number> = {
      herbivore: 10,
      omnivore: 8,
      carnivore: 2
    }
    const herdTiles: number[] = []
    for (const diet of DIET_CLASSES) {
      const founder = founderGenome(this.rng, diet, 0)
      founder[TRAIT_INDEX.hue] = diet === 'herbivore' ? 120 : diet === 'carnivore' ? 10 : 45
      const record = this.species.found(founder, -1, 0)
      const count = config.population.founders[diet] ?? 0
      const radius = founderRing[diet]
      for (let i = 0; i < count; i++) {
        // Carnivores settle next to an existing producer founder; producers
        // settle around the core and become the herd the hunters feed on.
        const anchor = diet === 'carnivore' && herdTiles.length > 0
          ? herdTiles[this.rng.int(herdTiles.length)]
          : core
        const tile = this.world.findSpawnNear(this.rng, anchor, radius)
        this.spawnFounder(founderGenome(this.rng, diet), record.id, tile)
        if (diet !== 'carnivore') herdTiles.push(tile)
      }
    }

    // Everything that exists at t = 0 is the baseline of the energy ledger:
    // the soil pools plus the energy the founders were created with.
    this.ledger.initial =
      this.world.totalBiomass() + this.world.totalDetritus() + this.totalCreatureEnergy()

    // Prime the climate and the first census so tick 0 already reports real values.
    this.world.updateEnvironment(config.environment, 0)
    this.world.stepVegetation(this.world.env, this.flux)
    this.absorbFlux()
    this.censusNow()
  }

  get size(): number {
    return this.creatures.length
  }

  /** Total energy currently held inside living creatures. */
  totalCreatureEnergy(): number {
    let sum = 0
    for (const c of this.creatures) sum += c.energy
    return sum
  }

  get rngStreamSeed(): number {
    return this.rng.seedId
  }

  /** Current season index + name, for the UI. */
  get season(): { index: number; name: string } {
    return { index: this.world.env.season, name: this.world.env.seasonName }
  }

  /** Advance the simulation by exactly one tick. */
  tickStep(): void {
    this.tick += 1
    const env = this.world.updateEnvironment(this.config.environment, this.tick)
    this.world.stepVegetation(env, this.flux)
    this.absorbFlux()

    this.rebuildSpatialIndex()

    for (let i = 0; i < this.creatures.length; i++) {
      const c = this.creatures[i]
      if (c.alive) this.updateCreature(c)
    }

    // Compact: drop dead creatures, append newborns (already id-ordered).
    let w = 0
    for (let r = 0; r < this.creatures.length; r++) {
      if (this.creatures[r].alive) this.creatures[w++] = this.creatures[r]
    }
    this.creatures.length = w
    if (this.newborns.length) {
      for (const b of this.newborns) b.pending = false
      for (let i = 0; i < this.newborns.length; i++) this.creatures.push(this.newborns[i])
      this.newborns.length = 0
    }

    if (this.tick % TERRAIN_REFRESH_PERIOD === 0) this.world.refreshTerrain()
    if (this.tick % CENSUS_PERIOD === 0) this.censusNow()
  }

  run(ticks: number): void {
    for (let i = 0; i < ticks; i++) this.tickStep()
  }

  /** The ledger identity, checked against the live pools. */
  auditEnergy(): EnergyAudit {
    const creatureEnergy = this.totalCreatureEnergy()
    const biomass = this.world.totalBiomass()
    const detritus = this.world.totalDetritus()
    const total = biomass + detritus + creatureEnergy
    const expected =
      this.ledger.initial +
      this.ledger.photosynthesis -
      this.ledger.plantRespiration -
      this.ledger.decomposition -
      this.ledger.burial -
      this.ledger.lifeHeat
    return { biomass, detritus, creatures: creatureEnergy, total, expected, delta: total - expected }
  }

  findCreature(id: number): Creature | undefined {
    // Binary search: creatures are kept in ascending id order.
    let lo = 0
    let hi = this.creatures.length - 1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const midId = this.creatures[mid].id
      if (midId === id) return this.creatures[mid]
      if (midId < id) lo = mid + 1
      else hi = mid - 1
    }
    return undefined
  }

  recordEvent(kind: EventKind, message: string, speciesId?: number): void {
    const event: SimEvent = { seq: this.eventSeq++, tick: this.tick, kind, message }
    if (speciesId !== undefined) event.speciesId = speciesId
    this.events.push(event)
    if (this.events.length > MAX_EVENTS) {
      this.events.splice(0, this.events.length - MAX_EVENTS)
      this.eventBase = this.events.length ? this.events[0].seq : this.eventSeq
    }
  }

  /** Samples of a census field, oldest first; `limit` keeps the most recent tail. */
  seriesSamples(field: CensusField, limit = 400): { ticks: number[]; values: number[] } {
    const buffer = this.series.get(field)
    if (!buffer) return { ticks: [], values: [] }
    return buffer.samples(Math.max(0, buffer.length - limit))
  }

  /** Latest value recorded for a census field. */
  seriesLatest(field: CensusField): number {
    return this.series.get(field)?.last() ?? 0
  }

  // ------------------------------------------------------------------
  // Internals
  // ------------------------------------------------------------------

  /** Books one tick of vegetation flux into the energy ledger. */
  private absorbFlux(): void {
    this.ledger.photosynthesis += this.flux.grossPrimaryProduction
    this.ledger.plantRespiration += this.flux.autotrophicRespiration
    this.ledger.decomposition += this.flux.decomposition
    this.ledger.burial += this.flux.buried
  }

  private spawnFounder(genome: Genome, speciesId: number, tile?: number): void {
    const phenotype = buildPhenotype(genome)
    const c = this.makeCreature(genome, phenotype, speciesId, tile ?? this.world.findSpawn(this.rng), 0)
    // A founding population is made of breeding-age adults, not newborns. Seeding
    // newborns means the producer band cannot reproduce for its whole maturation
    // age — the audits showed the founder herd being eaten to the last animal
    // before its first young was ever born, and the carnivore band starving
    // afterwards with nothing left to hunt. Adult founders reproduce from the
    // first season, which is what a founding population actually needs to do.
    c.age = phenotype.maturityAge
    c.energy = phenotype.maxEnergy * 0.75
    this.creatures.push(c)
    this.species.updateCentroid(speciesId, genome)
  }

  private makeCreature(
    genome: Genome,
    phenotype: Phenotype,
    speciesId: number,
    tile: number,
    birthTick: number,
    parentA = -1,
    parentB = -1,
    mate = -1
  ): Creature {
    const c: Creature = {
      id: this.nextId++,
      speciesId,
      x: tile % this.world.width,
      y: Math.floor(tile / this.world.width),
      tx: tile % this.world.width,
      ty: Math.floor(tile / this.world.width),
      energy: 0,
      maxEnergy: phenotype.maxEnergy,
      health: 1,
      minerals: phenotype.mineralDrain > 0 ? phenotype.mineralMax * 0.5 : 0,
      age: 0,
      behavior: BEHAVIOR_WANDER,
      reproCooldown: Math.round(phenotype.reproCooldownTicks * 0.5),
      offspringCount: 0,
      kills: 0,
      birthTick,
      localTemperature: this.world.temperature[tile] ?? 0,
      phenotype,
      genome,
      alive: true,
      huntTarget: -1
    }
    this.lineage.add(c.id, parentA, parentB, birthTick, mate)
    this.species.markBorn(speciesId)
    return c
  }

  private rebuildSpatialIndex(): void {
    const n = this.creatures.length
    for (let i = 0; i < n; i++) {
      const c = this.creatures[i]
      this.grid.assign(i, c.x, c.y)
    }
    this.grid.build(n)
    this.cellFood.fill(0)
    const { width, height } = this.world
    for (let y = 0; y < height; y++) {
      const rowBase = y * width
      const cellRow = Math.min(this.grid.rows - 1, Math.floor(y / this.grid.cellSize)) * this.grid.cols
      for (let x = 0; x < width; x++) {
        const b = this.world.biomass[rowBase + x]
        if (b > 0) {
          const cell = cellRow + Math.min(this.grid.cols - 1, Math.floor(x / this.grid.cellSize))
          if (b > this.cellFood[cell]) this.cellFood[cell] = b
        }
      }
    }
  }

  private neighborsWithin(
    c: Creature,
    radiusTiles: number,
    predicate: (other: Creature) => boolean,
    limit: number
  ): Creature[] {
    const out: Creature[] = []
    if (this.neighborBuf.length < this.creatures.length) {
      this.neighborBuf = new Int32Array(this.creatures.length)
    }
    const cx = clampInt(Math.floor(c.x / this.grid.cellSize), 0, this.grid.cols - 1)
    const cy = clampInt(Math.floor(c.y / this.grid.cellSize), 0, this.grid.rows - 1)
    const r = Math.ceil(radiusTiles / this.grid.cellSize)
    const count = this.grid.queryInto(cx, cy, r, this.neighborBuf)
    const r2 = radiusTiles * radiusTiles
    for (let k = 0; k < count && out.length < limit; k++) {
      const other = this.creatures[this.neighborBuf[k]]
      if (!other.alive || other.id === c.id) continue
      const dx = other.x - c.x
      const dy = other.y - c.y
      if (dx * dx + dy * dy > r2) continue
      if (predicate(other)) out.push(other)
    }
    return out
  }

  private crowdingAt(c: Creature): number {
    return this.neighborsWithin(c, 2.5, () => true, 32).length
  }

  private updateCreature(c: Creature): void {
    const ph = c.phenotype
    c.age += 1
    if (c.reproCooldown > 0) c.reproCooldown -= 1

    const tile = Math.floor(c.y) * this.world.width + Math.floor(c.x)
    const temp = this.world.temperature[tile]
    c.localTemperature = temp

    // --- thermoregulation and mineral upkeep (always paid) ------------------
    const dev = Math.abs(temp - ph.thermalOptimum)
    const over = dev - ph.thermalTolerance
    if (over > 0) c.health -= 0.02 * over
    const regulatory = Math.max(0, dev - 0.35 * ph.thermalTolerance)
    const thermoCost = 0.02 * regulatory * Math.pow(ph.mass, 0.4)

    c.minerals = Math.max(0, c.minerals - ph.mineralDrain)
    if (c.minerals < ph.mineralMax * 0.25) {
      const want = Math.min(0.1, ph.mineralMax * 0.5 - c.minerals)
      if (want > 0) {
        const taken = this.world.takeMineral(tile, want)
        c.minerals += taken
        if (taken === 0) c.health -= 0.002
      }
    }

    // --- decide behaviour ----------------------------------------------------
    const hunger = 1 - c.energy / ph.maxEnergy
    const canBreed =
      c.age >= ph.maturityAge &&
      c.reproCooldown <= 0 &&
      c.energy >= ph.reproThresholdEnergy &&
      c.minerals >= ph.mineralMax * 0.2
    // Threat detection uses the flight-initiation distance, not the full
    // sensory range: an animal notices distant hunters but only sprints away
    // from ones that can actually reach it.
    const predators = this.neighborsWithin(
      c,
      Math.min(ph.senseRadius, FLEE_INITIATION_DISTANCE),
      (o) => o.speciesId !== c.speciesId && o.phenotype.diet > 0.34 && o.phenotype.mass > c.phenotype.mass * 1.2,
      3
    )
    // A fit animal with reserves in the bank reserves the flight option: an
    // animal flees when a hunter is close enough to reach it and the animal
    // can pay for the sprint. Fit animals do not wait to be bitten — under
    // the previous gate only already-wounded animals ever fled, so calm
    // adults were bitten at will and a small founder crop of hunters
    // harvested the producer band to near-extinction inside one generation,
    // and then starved once the food was gone. Fleeing still has to be
    // fundable: an animal on a nearly empty stomach keeps eating, because
    // standing its ground is the only option it can actually fund. Wounded
    // animals run on a thinner reserve, because for them staying is what
    // gets them killed.
    const threatened =
      predators.length > 0 &&
      c.energy > ph.maxEnergy * (c.health < 0.9 ? 0.25 : 0.45)
    const starving = c.energy < ph.maxEnergy * 0.22

    // Wounded animals heal by settling, and the engine's only repair mechanism
    // is the REST branch below. The settle trigger must line up with the
    // injury threshold that creates the problem (the threat gate penalises
    // animals at health < 0.9): an adult wounded between 0.3 and 0.9 can fund
    // neither another sprint nor a breeding attempt (the breeding gate needs
    // 50% energy, the flee gate turns off at 45%), so without this it stalls
    // between the two gates until the next attack kills it. A wounded animal
    // settles to heal when no hunter is actually pressing it; an animal being
    // chased cannot afford to stand still, and it keeps eating instead.
    // Candidate (m): how much plant food this animal's juveniles are allowed
    // to eat (0 for adults, and 0 for anything not in the strict band). It is
    // computed here, before the decision chain, because a desperate juvenile
    // and a merely hungry one need the same number.
    const allowance = this.juvenilePlantAllowance(c)

    if (c.health < 0.9 && predators.length === 0 && c.energy > ph.maxEnergy * 0.45) {
      c.behavior = BEHAVIOR_REST
    } else if (starving) {
      // A starving animal near the carnivore boundary eats whatever is in front
      // of it; with allowance disabled this is the original ternary exactly.
      c.behavior = ph.diet < 0.6 || allowance >= 0.5 ? BEHAVIOR_FORAGE : BEHAVIOR_HUNT
    } else if (threatened) {
      c.behavior = BEHAVIOR_FLEE
    } else if (canBreed) {
      c.behavior = BEHAVIOR_MATE
    } else if (hunger > 0.18) {
      // A strict carnivore does not stand over a grazing animal and starve
      // beside it — an adult in the band ignores plants outright. A juvenile
      // with an allowance takes the concession at a probability equal to its
      // size, so the graded diet gene keeps deciding how often it feeds.
      if (ph.diet < 0.5) c.behavior = BEHAVIOR_FORAGE
      else if (allowance > 0 && this.rng.bool(allowance)) c.behavior = BEHAVIOR_FORAGE
      else c.behavior = ph.diet > 0.66 ? BEHAVIOR_HUNT : this.rng.bool(0.5) ? BEHAVIOR_FORAGE : BEHAVIOR_HUNT
    } else {
      c.behavior = BEHAVIOR_WANDER
    }

    // --- act ------------------------------------------------------------------
    let moved = 0
    switch (c.behavior) {
      case BEHAVIOR_FORAGE:
        moved = this.behaveForage(c)
        break
      case BEHAVIOR_HUNT:
        moved = this.behaveHunt(c)
        break
      case BEHAVIOR_FLEE:
        moved = this.behaveFlee(c, predators[0])
        break
      case BEHAVIOR_MATE:
        moved = this.behaveMate(c)
        break
      case BEHAVIOR_REST:
        c.health = Math.min(1, c.health + 0.012)
        break
      default:
        moved = this.behaveWander(c)
        break
    }

    // --- energy ledger for this creature --------------------------------------
    const resting = c.behavior === BEHAVIOR_REST
    const metabolic = ph.basalRate * (resting ? 0.5 : 1)
    const moveCost = ph.moveCostCoefficient * moved * moved
    // An animal can only burn the energy it actually holds. Clamping the bill to
    // the energy on hand is what keeps the pools and the ledger identical: burning
    // more than an animal has would book heat that never left the biomass pool.
    const costs = metabolic + moveCost + thermoCost
    const spent = c.energy < costs ? c.energy : costs
    c.energy -= spent
    this.ledger.lifeHeat += spent
    // Burning tissue gives the nutrients it carried back to the soil where the
    // animal stands, which is what keeps the nutrient cycle closed.
    this.world.releaseNutrients(tile, spent)

    // --- mortality ------------------------------------------------------------
    const crowd = c.behavior !== BEHAVIOR_REST ? this.crowdingAt(c) : 0
    if (crowd > 6) {
      const diseaseChance = (0.004 + 0.0015 * crowd) * (1 - ph.immune)
      if (this.rng.bool(diseaseChance)) {
        c.health -= 0.3
        if (c.health <= 0) {
          this.kill(c, 'disease')
          return
        }
      }
    }
    if (c.age > ph.maxAge) {
      this.kill(c, 'old age')
      return
    }
    if (c.health <= 0) {
      this.kill(c, over > 0 ? 'thermal stress' : 'disease')
      return
    }
    if (c.energy <= 0) {
      this.kill(c, 'starvation')
      return
    }
  }

  /** Move `c` toward (tx,ty) by at most its speed (scaled by `speedScale`). Returns tiles moved. */
  private moveToward(c: Creature, tx: number, ty: number, speedScale = 1): number {
    const ph = c.phenotype
    let dx = tx - c.x
    let dy = ty - c.y
    const dist = Math.hypot(dx, dy)
    if (dist < 1e-6) return 0
    const step = Math.min(ph.speed * speedScale, dist)
    dx = (dx / dist) * step
    dy = (dy / dist) * step
    let nx = c.x + dx
    let ny = c.y + dy
    nx = clamp(nx, 0, this.world.width - 1.001)
    ny = clamp(ny, 0, this.world.height - 1.001)
    const tile = Math.floor(ny) * this.world.width + Math.floor(nx)
    if (this.world.terrain[tile] === 0) {
      // Deep water: try sliding along the coast first.
      const altTileX = Math.floor(c.y) * this.world.width + Math.floor(clamp(c.x + dx, 0, this.world.width - 1.001))
      if (this.world.terrain[altTileX] !== 0) {
        c.x = clamp(c.x + dx, 0, this.world.width - 1.001)
      } else {
        const altTileY = Math.floor(clamp(c.y + dy, 0, this.world.height - 1.001)) * this.world.width + Math.floor(c.x)
        if (this.world.terrain[altTileY] !== 0) {
          c.y = clamp(c.y + dy, 0, this.world.height - 1.001)
        } else {
          return 0
        }
      }
    } else {
      c.x = nx
      c.y = ny
    }
    return step
  }

  private pickForageTarget(c: Creature): void {
    const ph = c.phenotype
    const r = Math.max(1, Math.ceil(ph.senseRadius / this.grid.cellSize))
    const cx = clampInt(Math.floor(c.x / this.grid.cellSize), 0, this.grid.cols - 1)
    const cy = clampInt(Math.floor(c.y / this.grid.cellSize), 0, this.grid.rows - 1)
    let bestScore = -1
    let bestX = -1
    let bestY = -1
    const x0 = Math.max(0, cx - r)
    const x1 = Math.min(this.grid.cols - 1, cx + r)
    const y0 = Math.max(0, cy - r)
    const y1 = Math.min(this.grid.rows - 1, cy + r)
    for (let gy = y0; gy <= y1; gy++) {
      for (let gx = x0; gx <= x1; gx++) {
        const cell = gy * this.grid.cols + gx
        const food = this.cellFood[cell]
        if (food <= 0.01) continue
        const ccx = gx * this.grid.cellSize + this.grid.cellSize / 2
        const ccy = gy * this.grid.cellSize + this.grid.cellSize / 2
        const dist = Math.hypot(ccx - c.x, ccy - c.y)
        // Ground another animal is already eating is worth less. Without this every
        // herbivore in the region ranks the same patch first, walks onto it and
        // strips it bare; interference competition is what spreads a herd out.
        const rivals = this.grid.occupancy(cell)
        const score = food / (1 + 0.15 * dist + 0.7 * rivals)
        if (score > bestScore) {
          bestScore = score
          bestX = ccx
          bestY = ccy
        }
      }
    }
    if (bestX >= 0) {
      // Aim off-centre so a herd covers a patch instead of stacking on one point.
      const spread = this.grid.cellSize * 0.45
      c.tx = clamp(bestX + this.rng.symmetric(spread), 0, this.world.width - 1)
      c.ty = clamp(bestY + this.rng.symmetric(spread), 0, this.world.height - 1)
    } else {
      this.pickWanderTarget(c)
    }
  }

  private pickWanderTarget(c: Creature): void {
    const pull = this.rng.range(0.4, 1.2)
    if (c.phenotype.sociality > 0.5 && this.rng.bool(c.phenotype.sociality)) {
      const peers = this.neighborsWithin(
        c,
        12,
        (o) => o.speciesId === c.speciesId,
        4
      )
      if (peers.length) {
        const leader = peers[this.rng.int(peers.length)]
        c.tx = clamp(leader.x + this.rng.symmetric(2), 0, this.world.width - 1)
        c.ty = clamp(leader.y + this.rng.symmetric(2), 0, this.world.height - 1)
        return
      }
    }
    c.tx = clamp(c.x + this.rng.symmetric(6 * pull), 0, this.world.width - 1)
    c.ty = clamp(c.y + this.rng.symmetric(6 * pull), 0, this.world.height - 1)
  }

  private behaveWander(c: Creature): number {
    if (this.rng.bool(0.15) || (Math.abs(c.tx - c.x) < 0.3 && Math.abs(c.ty - c.y) < 0.3)) {
      this.pickWanderTarget(c)
    }
    return this.moveToward(c, c.tx, c.ty)
  }

  private behaveForage(c: Creature): number {
    const ph = c.phenotype
    const room = ph.maxEnergy - c.energy
    if (room <= 0.01) return 0
    const tile = Math.floor(c.y) * this.world.width + Math.floor(c.x)
    const bite = Math.min(ph.bitePlant, room)
    const eaten = this.world.graze(tile, bite)
    if (eaten > 0) {
      // Candidate (m): a strict carnivore's juvenile plant channel is not free.
      // The animal's bite is already small at a meat diet, and its gut is
      // tuned for meat rather than grass, so the concession absorbs only a
      // fraction of what it crops — graded by the same diet gene. A lineage
      // that leans on it as a juvenile pays for it in absorbed energy, which is
      // what keeps selection acting on the diet gene instead of cancelling it.
      const allowance = this.juvenilePlantAllowance(c)
      const digest = allowance > 0 ? ph.digest * allowance : ph.digest
      const absorbed = Math.min(room, eaten * digest)
      c.energy += absorbed
      const waste = eaten - absorbed
      if (waste > 0) this.deposit(tile, waste)
      return 0 // feeding instead of moving
    }
    if (Math.abs(c.tx - c.x) < 0.4 && Math.abs(c.ty - c.y) < 0.4) {
      this.pickForageTarget(c)
    }
    return this.moveToward(c, c.tx, c.ty)
  }

  /** Is `o` legal quarry for hunter `c` under the engine's predation gates? */
  private preyIsLegal(c: Creature, o: Creature): boolean {
    return (
      o.alive &&
      o.id !== c.id &&
      o.speciesId !== c.speciesId &&
      // Dependent young are not legal quarry. A newborn spawns beside its
      // parents, cannot outrun a hunter, and for a strict meat-eater is an
      // easy, energy-rich target: measured in the breeding probe, 26 of 59
      // deaths in one window were juveniles — the new cohorts were being
      // eaten as they were born, so recruitment died together with the
      // adults and the producer bands could not replace themselves.
      // maturityAge is the engine's own threshold for an animal standing on
      // its own; until then the young are with their parents.
      o.age >= o.phenotype.maturityAge &&
      o.phenotype.mass < c.phenotype.mass * (0.35 + 1.7 * c.phenotype.diet) &&
      o.energy > 0.2
    )
  }

  /**
   * Pick the quarry to chase. A hunt is committed: the current quarry is kept
   * until it dies, stops being legal quarry, leaves the extended pursuit
   * radius, or stops being worth chasing (see pursuitIsWorthwhile) — only then
   * is a new one chosen, and the nearest worth-chasing animal wins.
   *
   * Re-picking every tick (the old behaviour, taking whichever legal animal the
   * scan found first) makes pursuit thrash in dense populations: the target
   * changes every tick, no chase ever reaches contact, and hunters starve in
   * sight of abundant prey.
   */
  private pickQuarry(c: Creature): Creature | undefined {
    const ph = c.phenotype
    const previous = c.huntTarget >= 0 ? this.findCreature(c.huntTarget) : undefined
    if (
      previous &&
      previous.alive &&
      this.preyIsLegal(c, previous) &&
      Math.hypot(previous.x - c.x, previous.y - c.y) <= ph.senseRadius * 1.5 &&
      this.pursuitIsWorthwhile(c, previous)
    ) {
      return previous
    }
    let best: Creature | undefined
    let bestDist2 = ph.senseRadius * ph.senseRadius
    for (const o of this.neighborsWithin(c, ph.senseRadius, (o) => this.preyIsLegal(c, o), 32)) {
      const dx = o.x - c.x
      const dy = o.y - c.y
      const d2 = dx * dx + dy * dy
      if (d2 < bestDist2 && this.pursuitIsWorthwhile(c, o)) {
        bestDist2 = d2
        best = o
      }
    }
    c.huntTarget = best ? best.id : -1
    return best
  }

  /**
   * Is a chase worth committing to? A hunt is an investment: the predator spends
   * hunting-tick energy for every tick it takes to close the gap, and the most
   * a bite can deliver is the energy the quarry's body holds, at this
   * predator's absorption rate, capped by the room left in its own reserve.
   * Compare the two and the hunt has a break-even distance — the classic
   * giving-up rule of foraging models, derived here entirely from the engine's
   * own phenotype numbers.
   *
   * Without this gate a hunter commits to every animal it can see. Measured
   * founder carnivores paid ~0.52 energy per hunting tick and closed under a
   * tile per tick on fleeing prey, so a chase that started at any distance cost
   * more than a kill could ever pay back: the band bled its reserves chasing
   * quarry it could not reach.
   */
  private pursuitIsWorthwhile(c: Creature, quarry: Creature): boolean {
    const ph = c.phenotype
    const dist = Math.hypot(quarry.x - c.x, quarry.y - c.y)

    // A gap already within one stride costs nothing extra to attempt: strike.
    if (dist < ph.speed + 0.6) return true

    // What the bite can deliver: the energy in the quarry's body, at this
    // predator's absorption rate, capped by the room left in its reserve.
    const room = Math.max(0, ph.maxEnergy - c.energy)
    const payoff = Math.min(quarry.energy, room) * (0.45 + 0.45 * ph.digest)

    // A quarry only truly escapes if it can pay for running; wounded and
    // desperate prey stand their ground, which is what makes them reachable.
    // Mirrors the prey's own flight gate in the decision flow.
    const preyFlees =
      quarry.health >= 0.9 && quarry.energy > quarry.phenotype.maxEnergy * 0.45
    const closing = ph.speed - (preyFlees ? quarry.phenotype.speed : 0)
    if (closing <= 0.05) return false // cannot gain ground on this quarry at all

    const huntTickCost = ph.basalRate + ph.moveCostCoefficient * ph.speed * ph.speed
    const expectedCost = huntTickCost * (dist / closing)
    return expectedCost <= payoff
  }

  /**
   * Candidate (m): juvenile plant allowance. A strict carnivore (diet > 0.66)
   * that has not yet reached maturity may take plants; the same adult genome
   * never may. The return value is the allowance strength: it is full at the
   * carnivore boundary (diet 0.66) and falls to a floor at full carnivory
   * (1.0), so a lineage's juvenile concession tracks how close its diet gene
   * sits to the omnivore boundary — selection can act on the gene along that
   * gradient instead of the concession being handed to the whole band.
   */
  private juvenilePlantAllowance(c: Creature): number {
    const ph = c.phenotype
    if (ph.diet <= 0.66 || c.age >= ph.maturityAge) return 0
    return Math.max(0.2, Math.min(1, 1 - (ph.diet - 0.66) / 0.34))
  }

  private behaveHunt(c: Creature): number {
    const ph = c.phenotype
    if (ph.diet < 0.2) return this.behaveForage(c)
    const quarry = this.pickQuarry(c)
    if (quarry) {
      const dist = Math.hypot(quarry.x - c.x, quarry.y - c.y)
      // A strike covers the hunter's whole lunge: the bite connects when the
      // hunter can cross the current gap and the quarry's next flee step in
      // one stride. A fixed 0.6-tile reach deadlocks pursuit whenever the
      // quarry flees just below the hunter's speed: prey always act before
      // hunters in tick order, so the hunter lands exactly on top of the
      // quarry at the end of each tick, the quarry slips away before the
      // hunter's next decision, and the hunter burns energy forever without
      // ever landing a hit — starving in sight of prey it is faster than.
      if (dist < ph.speed + 0.6) {
        this.attack(c, quarry)
        return 0
      }
      c.tx = quarry.x
      c.ty = quarry.y
      return this.moveToward(c, quarry.x, quarry.y)
    }
    if (ph.diet < 0.7) return this.behaveForage(c)
    // Candidate (m): a strict carnivore with nothing legal in sight starves
    // looking for it. An adult accepts that as the cost of its diet; a
    // juvenile with an allowance does not have to walk an empty landscape
    // when there is grass under its feet.
    if (this.juvenilePlantAllowance(c) > 0) return this.behaveForage(c)
    if (Math.abs(c.tx - c.x) < 0.4 && Math.abs(c.ty - c.y) < 0.4) {
      this.pickWanderTarget(c)
    }
    // Searching without quarry: an animal that can still afford to search
    // does so cruising, never sprinting. Move cost is quadratic in tiles
    // moved, so cruising at a fraction of top speed costs the square of that
    // fraction. Carnivores that sprinted across an empty landscape starved
    // within sight of the prey recovery.
    if (c.energy < ph.maxEnergy * 0.45) {
      // No legal prey in sight and the reserve is below the chase floor: a
      // depleted carnivore stops roaming and waits out the lean spell.
      // Roaming an empty landscape spends the reserve on travel that cannot
      // end in a kill; standing still bills half the maintenance rate, so a
      // predator can hold on until the prey band recovers instead of dying a
      // generation before it. Legal prey coming into sight still starts the
      // normal hunt.
      c.behavior = BEHAVIOR_REST
      return 0
    }
    return this.moveToward(c, c.tx, c.ty, 0.4)
  }

  private behaveFlee(c: Creature, threat: Creature | undefined): number {
    const away = threat ? Math.atan2(c.y - threat.y, c.x - threat.x) : this.rng.range(0, Math.PI * 2)
    const tx = clamp(c.x + Math.cos(away) * 8, 0, this.world.width - 1)
    const ty = clamp(c.y + Math.sin(away) * 8, 0, this.world.height - 1)
    return this.moveToward(c, tx, ty)
  }

  private behaveMate(c: Creature): number {
    const mate = this.neighborsWithin(
      c,
      c.phenotype.senseRadius,
      (o) =>
        o.speciesId === c.speciesId &&
        o.id !== c.id &&
        o.age >= o.phenotype.maturityAge &&
        o.age < o.phenotype.maxAge * 0.9 &&
        o.reproCooldown <= 0 &&
        o.energy >= o.phenotype.reproThresholdEnergy * 0.9 &&
        o.minerals >= o.phenotype.mineralMax * 0.2 &&
        !this.related(c, o),
      1
    )
    if (!mate.length) {
      const anyKin = this.neighborsWithin(
        c,
        c.phenotype.senseRadius,
        (o) => o.speciesId === c.speciesId && o.id !== c.id && o.age >= o.phenotype.maturityAge,
        1
      )
      if (anyKin.length) {
        c.tx = anyKin[0].x
        c.ty = anyKin[0].y
        return this.moveToward(c, c.tx, c.ty)
      }
      this.pickWanderTarget(c)
      return this.moveToward(c, c.tx, c.ty)
    }
    const partner = mate[0]
    const dist = Math.hypot(partner.x - c.x, partner.y - c.y)
    if (dist > 0.7) return this.moveToward(c, partner.x, partner.y)
    this.breed(c, partner)
    return 0
  }

  private breed(a: Creature, b: Creature): void {
    if (this.creatures.length + this.newborns.length >= this.config.population.maxCreatures) return
    // Each parent pays half the brood cost of its own phenotype, and the newborn
    // receives exactly what both parents gave up: reproduction conserves energy.
    const fromA = a.phenotype.broodEnergyPerOffspring * 0.5
    const fromB = b.phenotype.broodEnergyPerOffspring * 0.5
    const brood = Math.max(1, Math.round(a.genome[TRAIT_INDEX.litterSize]))
    const count = Math.min(brood, Math.floor(a.energy / fromA), Math.floor(b.energy / fromB))
    if (count <= 0) return

    a.reproCooldown = Math.round(a.phenotype.reproCooldownTicks)
    b.reproCooldown = Math.round(b.phenotype.reproCooldownTicks)

    const childGenome = newGenome()
    for (let i = 0; i < count; i++) {
      inherit(this.rng, a.genome, b.genome, childGenome)
      mutate(this.rng, childGenome, this.config.evolution.mutationRate, this.config.evolution.mutationStrength)
      const assigned = this.species.assign(
        childGenome,
        a.speciesId,
        this.config.evolution.speciationThreshold,
        this.tick
      )
      const speciesId = assigned.speciesId
      if (assigned.isNew) {
        const rec = this.species.get(speciesId)
        this.recordEvent(
          'speciation',
          `${rec?.name ?? 'species'} diverged from ${this.species.get(a.speciesId)?.name ?? 'parent'}`,
          speciesId
        )
      }
      const genome = cloneGenome(childGenome)
      this.species.updateCentroid(speciesId, genome)
      const tile = this.spawnSpotNear(a)
      const child = this.makeCreature(
        genome,
        buildPhenotype(genome),
        speciesId,
        tile,
        this.tick,
        a.id,
        b.id,
        b.id
      )
      child.energy = fromA + fromB
      child.maxEnergy = Math.max(child.maxEnergy, child.energy)
      child.pending = true
      a.energy -= fromA
      b.energy -= fromB
      a.offspringCount += 1
      b.offspringCount += 1
      a.minerals = Math.max(0, a.minerals - 0.1)
      b.minerals = Math.max(0, b.minerals - 0.1)
      this.newborns.push(child)
      this.birthsSinceCensus += 1
    }
  }

  private spawnSpotNear(a: Creature): number {
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = clampInt(Math.round(a.x + this.rng.symmetric(1.5)), 0, this.world.width - 1)
      const y = clampInt(Math.round(a.y + this.rng.symmetric(1.5)), 0, this.world.height - 1)
      const tile = y * this.world.width + x
      if (this.world.terrain[tile] !== 0) return tile
    }
    return Math.floor(a.y) * this.world.width + Math.floor(a.x)
  }

  private related(a: Creature, b: Creature): boolean {
    if (!this.config.evolution.avoidInbreeding) return false
    if (!this.lineage.has(a.id) || !this.lineage.has(b.id)) return false
    const [a1, a2] = this.lineage.parentsOf(a.id)
    const [b1, b2] = this.lineage.parentsOf(b.id)
    if (a1 < 0 || a2 < 0 || b1 < 0 || b2 < 0) return false
    if (a1 === b1 || a1 === b2 || a2 === b1 || a2 === b2) return true
    const [a11] = this.lineage.parentsOf(a1)
    const [a12] = this.lineage.parentsOf(a2)
    const [b11] = this.lineage.parentsOf(b1)
    const [b12] = this.lineage.parentsOf(b2)
    const aGrand = [a11, this.otherParent(a1), a12, this.otherParent(a2)].filter((v) => v >= 0)
    const bGrand = [b11, this.otherParent(b1), b12, this.otherParent(b2)].filter((v) => v >= 0)
    for (const g of aGrand) if (bGrand.includes(g)) return true
    return false
  }

  private otherParent(id: number): number {
    const [p1, p2] = this.lineage.parentsOf(id)
    return p2 >= 0 ? p2 : p1
  }

  private attack(c: Creature, prey: Creature): void {
    const damage = (0.1 + 0.5 * c.phenotype.aggression) * (0.4 + 0.6 * c.phenotype.speed)
    prey.health -= damage
    if (prey.health > 0) return
    const transferable = prey.energy
    const room = c.phenotype.maxEnergy - c.energy
    const absorbed = Math.min(room, transferable * (0.45 + 0.45 * c.phenotype.digest))
    c.energy += absorbed
    const leftover = transferable - absorbed
    const tile = Math.floor(prey.y) * this.world.width + Math.floor(prey.x)
    if (leftover > 0) this.deposit(tile, leftover)
    prey.energy = 0
    c.kills += 1
    this.kill(prey, 'predation')
  }

  /** Mark a creature dead. Whatever energy is left becomes litter. */
  private kill(c: Creature, cause: DeathCause): void {
    if (!c.alive) return
    c.alive = false
    this.deathsSinceCensus += 1
    this.deathsByCause[cause] += 1
    if (c.energy > 0) {
      const tile = Math.floor(c.y) * this.world.width + Math.floor(c.x)
      this.deposit(tile, c.energy)
      c.energy = 0
    }
  }

  /** Deaths since the start of the run, by cause. */
  deathTotals(): Record<DeathCause, number> {
    const out = {} as Record<DeathCause, number>
    for (const key of Object.keys(this.deathsByCause) as DeathCause[]) out[key] = this.deathsByCause[key]
    return out
  }

  /** Total deaths since the start of the run. */
  totalDeaths(): number {
    let total = 0
    for (const key of Object.keys(this.deathsByCause) as DeathCause[]) total += this.deathsByCause[key]
    return total
  }

  private deposit(tile: number, amount: number): void {
    const overflow = this.world.depositDetritus(tile, amount)
    if (overflow > 0) this.ledger.burial += overflow
  }

  private censusNow(): void {
    const { census, speciesCounts } = computeCensus(this.creatures, this.tick, this.species.size, {
      temperatureMean: this.flux.temperatureMean,
      biomass: this.world.totalBiomass(),
      detritus: this.world.totalDetritus(),
      mineral: this.world.totalMineral(),
      gpp: this.flux.grossPrimaryProduction
    })

    // The registry is the only place living counts are stored.
    for (let s = 0; s < speciesCounts.length; s++) this.species.census(s, speciesCounts[s], this.tick)

    const extinct = this.species.detectExtinctions(this.prevSpeciesCounts, speciesCounts, this.tick)
    for (const rec of extinct) {
      this.recordEvent('extinction', `${rec.name} went extinct`, rec.id)
    }
    this.prevSpeciesCounts = speciesCounts

    census.speciesAlive = this.species.livingCount()
    census.speciesTotal = this.species.size
    census.births = this.birthsSinceCensus
    census.deaths = this.deathsSinceCensus
    this.birthsSinceCensus = 0
    this.deathsSinceCensus = 0

    if (this.lastCensus && this.lastCensus.population >= EVENT_POP_THRESHOLD) {
      const prev = this.lastCensus.population
      if (census.population < prev * 0.6) {
        this.recordEvent('population_crash', `Population crashed: ${prev} -> ${census.population}`)
      } else if (census.population > prev * 1.67 && census.population < this.config.population.maxCreatures * 0.9) {
        this.recordEvent('population_boom', `Population boomed: ${prev} -> ${census.population}`)
      }
    }

    this.lastCensus = census
    for (const field of CHART_FIELDS) {
      const buffer = this.series.get(field)
      if (buffer) buffer.push(this.tick, census[field])
    }
  }

  /** Serialise the whole world + population to a plain-data state. */
  toState(): SimulationState {
    const n = this.creatures.length
    const save: CreatureSave = {
      ids: new Int32Array(n),
      speciesIds: new Int32Array(n),
      x: new Float32Array(n),
      y: new Float32Array(n),
      energy: new Float32Array(n),
      maxEnergy: new Float32Array(n),
      health: new Float32Array(n),
      age: new Int32Array(n),
      minerals: new Float32Array(n),
      behavior: new Int32Array(n),
      reproCooldown: new Int32Array(n),
      offspringCount: new Int32Array(n),
      kills: new Int32Array(n),
      birthTick: new Int32Array(n),
      genomes: new Float32Array(n * TRAIT_COUNT)
    }
    for (let i = 0; i < n; i++) {
      const c = this.creatures[i]
      save.ids[i] = c.id
      save.speciesIds[i] = c.speciesId
      save.x[i] = c.x
      save.y[i] = c.y
      save.energy[i] = c.energy
      save.maxEnergy[i] = c.maxEnergy
      save.health[i] = c.health
      save.age[i] = c.age
      save.minerals[i] = c.minerals
      save.behavior[i] = c.behavior
      save.reproCooldown[i] = c.reproCooldown
      save.offspringCount[i] = c.offspringCount
      save.kills[i] = c.kills
      save.birthTick[i] = c.birthTick
      save.genomes.set(c.genome, i * TRAIT_COUNT)
    }
    return {
      version: SIM_STATE_VERSION,
      config: JSON.parse(JSON.stringify(this.config)) as SimConfig,
      tick: this.tick,
      nextId: this.nextId,
      rngState: this.rng.getState(),
      rngSeed: this.rng.seedId,
      ledger: { ...this.ledger },
      worldElevation: Float32Array.from(this.world.elevation),
      worldMoisture: Float32Array.from(this.world.moisture),
      worldFertility: Float32Array.from(this.world.fertility),
      worldCapacity: Float32Array.from(this.world.capacity),
      worldBiomass: Float32Array.from(this.world.biomass),
      worldDetritus: Float32Array.from(this.world.detritus),
      worldMineral: Float32Array.from(this.world.mineral),
      creatures: save,
      species: this.species.snapshot(),
      lineage: this.lineage.snapshot()
    }
  }

  /** Rebuild a simulation from a previously exported state. */
  static fromState(state: SimulationState): Simulation {
    const sim = new Simulation(JSON.parse(JSON.stringify(state.config)) as SimConfig)
    sim.tick = state.tick
    sim.ledger = { ...state.ledger }
    sim.world.elevation.set(state.worldElevation)
    sim.world.moisture.set(state.worldMoisture)
    sim.world.fertility.set(state.worldFertility)
    sim.world.capacity.set(state.worldCapacity)
    sim.world.biomass.set(state.worldBiomass)
    sim.world.detritus.set(state.worldDetritus)
    sim.world.mineral.set(state.worldMineral)
    sim.world.seaLevel = state.config.world.seaLevel
    sim.world.refreshTerrain()
    sim.species.restore(state.species)
    sim.lineage.restore(state.lineage)
    sim.creatures = []
    const n = state.creatures.ids.length
    for (let i = 0; i < n; i++) {
      const genome = new Float32Array(TRAIT_COUNT)
      for (let t = 0; t < TRAIT_COUNT; t++) genome[t] = state.creatures.genomes[i * TRAIT_COUNT + t]
      const phenotype = buildPhenotype(genome)
      const tile = Math.min(
        Math.floor(state.creatures.y[i]) * sim.world.width + Math.floor(state.creatures.x[i]),
        sim.world.size - 1
      )
      const c: Creature = {
        id: state.creatures.ids[i],
        speciesId: state.creatures.speciesIds[i],
        x: state.creatures.x[i],
        y: state.creatures.y[i],
        tx: state.creatures.x[i],
        ty: state.creatures.y[i],
        energy: state.creatures.energy[i],
        maxEnergy: state.creatures.maxEnergy[i] || phenotype.maxEnergy,
        health: state.creatures.health[i],
        age: state.creatures.age[i],
        minerals: state.creatures.minerals[i],
        behavior: state.creatures.behavior[i],
        reproCooldown: state.creatures.reproCooldown[i],
        offspringCount: state.creatures.offspringCount[i],
        kills: state.creatures.kills[i],
        birthTick: state.creatures.birthTick[i],
        localTemperature: sim.world.temperature[tile],
        phenotype,
        genome,
        alive: true,
        huntTarget: -1
      }
      sim.creatures.push(c)
    }
    sim.nextId = state.nextId
    sim.prevSpeciesCounts = new Int32Array(Math.max(1, sim.species.size))
    sim.rng.loadState(state.rngState)
    sim.censusNow()
    return sim
  }
}

function clampInt(value: number, min: number, max: number): number {
  const v = Math.round(value)
  return v < min ? min : v > max ? max : v
}
