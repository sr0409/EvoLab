/**
 * UI state for the interface (milestone 4).
 *
 * The Simulation instance is deliberately kept OUT of Vue's reactivity: it is a
 * large hot object and making it reactive would slow the engine down for no
 * benefit. The reactive `ui` object mirrors only the small control state the
 * interface needs, and bumps `frame` after every simulation frame so panels
 * and canvases know when to redraw. The engine itself is reached through
 * `getSim()`, which returns the plain instance.
 */
import { reactive } from 'vue'
import { Simulation } from './sim/engine'
import {
  setPopulationCap as applyPopulationCap,
  setMinPreyEnergy as applyMinPreyEnergy,
  setAssimilationBase as applyAssimilationBase,
  applyScenario,
  defaultConfig,
  findScenario
} from './sim/config'

export const SPEED_PRESETS = [
  { label: '0.5×', ticksPerSecond: 2 },
  { label: '1×', ticksPerSecond: 4 },
  { label: '2×', ticksPerSecond: 5 },
  { label: '10×', ticksPerSecond: 10 }
] as const

/** Hard cap on ticks per animation frame: keeps the UI responsive on slow machines. */
const MAX_TICKS_PER_FRAME = 12

export type MapView = 'terrain' | 'biomass' | 'temperature'

let sim = new Simulation(defaultConfig())

const ui = reactive({
  running: false,
  speedIndex: 2,
  mapView: 'biomass' as MapView,
  scenarioId: '',
  /**
   * The population ceiling in force on the live simulation, mirrored from
   * `sim.config.population.maxCreatures` so the control bar can show and edit it
   * even while the world is paused. The engine keeps reading the config value
   * every tick; this is the UI's view of it.
   */
  populationCap: sim.config.population.maxCreatures,
  /**
   * The quarry-energy floor in force on the live simulation, mirrored from
   * `sim.config.predation.minPreyEnergy` (milestone 9). The engine re-reads
   * that config value every tick, so changing it acts on a running world.
   */
  minPreyEnergy: sim.config.predation.minPreyEnergy,
  /**
   * The gut constant in force on the live world, mirrored from
   * `sim.config.predation.assimilationBase` so the control can show and edit it
   * on a running world. The engine reads the config value every tick, on both
   * the hunt decision and the harvest.
   */
  assimilationBase: sim.config.predation.assimilationBase,
  /** Bumped once per simulation frame; panels watch this to redraw. */
  frame: 0,
  /** Generation of the Simulation instance; changes when a world is replaced. */
  epoch: 0,
  selectedSpeciesId: -1
})

export { ui }

/** The live Simulation. Plain object — never make this reactive. */
export function getSim(): Simulation {
  return sim
}

let rafId = 0
let lastFrameTime = 0
let pendingTicks = 0

export function startLoop(): void {
  if (rafId === 0) {
    lastFrameTime = performance.now()
    rafId = requestAnimationFrame(loopFrame)
  }
}

export function stopLoop(): void {
  if (rafId !== 0) {
    cancelAnimationFrame(rafId)
    rafId = 0
  }
}

function loopFrame(now: number): void {
  rafId = requestAnimationFrame(loopFrame)
  const elapsed = Math.min((now - lastFrameTime) / 1000, 1)
  lastFrameTime = now

  if (ui.running) {
    const speed = SPEED_PRESETS[ui.speedIndex]
    pendingTicks += elapsed * speed.ticksPerSecond
    const batch = Math.min(Math.floor(pendingTicks), MAX_TICKS_PER_FRAME)
    if (batch > 0) {
      sim.run(batch)
      ui.frame++
    }
  } else {
    pendingTicks = 0
  }
}

/** Run exactly one tick even while paused (the UI "step" button). */
export function stepOnce(): void {
  sim.run(1)
  ui.frame++
}

export function toggleRunning(): void {
  ui.running = !ui.running
}

export function setSpeed(index: number): void {
  ui.speedIndex = Math.max(0, Math.min(SPEED_PRESETS.length - 1, index))
}

export function setMapView(view: MapView): void {
  ui.mapView = view
}

export function selectScenario(id: string): void {
  ui.scenarioId = id
  const scenario = findScenario(id)
  if (scenario) applyScenario(sim.config, scenario)
}

/**
 * Set the population ceiling on the running world, at any time. The engine reads
 * `config.population.maxCreatures` every tick, so the new ceiling applies on the
 * next tick without restarting the world: breeding stops while the population is
 * at or above it, and a population already above a lowered ceiling comes back
 * down through ordinary deaths instead of being culled. The value is remembered
 * so "new world" keeps it, the same way the selected scenario is kept.
 */
export function setPopulationCap(value: number): void {
  ui.populationCap = applyPopulationCap(sim.config, value)
  ui.frame++
}

/** Restore the default population ceiling. */
export function resetPopulationCap(): void {
  setPopulationCap(defaultConfig().population.maxCreatures)
}

/**
 * Set the quarry-energy floor (the engine's `prey.energy > 0.2` predation gate)
 * at any time. The engine reads `config.predation.minPreyEnergy` every tick, so
 * the new floor takes effect on the next tick of a running world: legal quarry
 * becomes only animals whose energy reserve sits above it. Like the population
 * ceiling, the value is carried across to a new world. (PROGRESS.md §6E.)
 */
export function setMinPreyEnergy(value: number): void {
  ui.minPreyEnergy = applyMinPreyEnergy(sim.config, value)
  ui.frame++
}

/** Restore the engine's original quarry-energy floor (0.2). */
export function resetMinPreyEnergy(): void {
  setMinPreyEnergy(defaultConfig().predation.minPreyEnergy)
}

/** Restore the engine's own gut constant (0.45, the base of the `0.45 + 0.45 · digest` absorption the engine has always used). */
export function resetAssimilationBase(): void {
  setAssimilationBase(defaultConfig().predation.assimilationBase)
}

/**
 * Set the assimilation base — the fraction of a prey body the predator's gut
 * takes before its gut-quality gene scales it — on the running world at any
 * time. The engine reads `config.predation.assimilationBase` every tick, on
 * both sides of a hunt: the valuation that decides whether to commit to a
 * chase, and the energy actually absorbed on a kill (the rest of the body
 * falls to litter, as before). Raising it raises carnivore intake per kill;
 * it does not change what counts as legal quarry, which is the prey-energy
 * floor's job. Like the other tuned controls, the value carries across to a
 * new world.
 */
export function setAssimilationBase(value: number): void {
  ui.assimilationBase = applyAssimilationBase(sim.config, value)
  ui.frame++
}

/**
 * Replace the simulation with a fresh world. If a scenario is selected it is
 * applied to the new config immediately, so "regenerate world" keeps the
 * selected climate preset; the manually set population ceiling, quarry-energy
 * floor, and assimilation base are carried over for the same reason: they are
 * part of the experiment the user is running, not per-world settings.
 */
export function newWorld(seed?: string): void {
  const config = defaultConfig()
  config.world.seed = seed && seed.trim() ? seed.trim() : randomSeed()
  const scenario = findScenario(ui.scenarioId)
  if (scenario) applyScenario(config, scenario)
  ui.populationCap = applyPopulationCap(config, ui.populationCap)
  applyMinPreyEnergy(config, ui.minPreyEnergy)
  applyAssimilationBase(config, ui.assimilationBase)
  sim = new Simulation(config)
  pendingTicks = 0
  ui.epoch++
  ui.frame++
}

export function selectSpecies(id: number): void {
  ui.selectedSpeciesId = id
}

/** A random world seed, for "new world" buttons without a user-supplied seed. */
function randomSeed(): string {
  return Math.random().toString(36).slice(2, 10)
}
