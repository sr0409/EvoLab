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
import { applyScenario, defaultConfig, findScenario } from './sim/config'

export const SPEED_PRESETS = [
  { label: '0.5×', ticksPerSecond: 2 },
  { label: '1×', ticksPerSecond: 4 },
  { label: '2×', ticksPerSecond: 5 },
  { label: '10×', ticksPerSecond: 10 }
] as const

/** Hard cap on ticks per animation frame: keeps the UI responsive on slow machines. */
const MAX_TICKS_PER_FRAME = 12

export type MapView = 'terrain' | 'biomass' | 'temperature'

const ui = reactive({
  running: false,
  speedIndex: 2,
  mapView: 'biomass' as MapView,
  scenarioId: '',
  /** Bumped once per simulation frame; panels watch this to redraw. */
  frame: 0,
  /** Generation of the Simulation instance; changes when a new world is made. */
  epoch: 0,
  selectedSpeciesId: -1
})

export { ui }

let sim = new Simulation(defaultConfig())

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
 * Replace the simulation with a fresh world. If a scenario is selected it is
 * applied to the new config immediately, so "regenerate world" keeps the
 * selected climate preset.
 */
export function newWorld(seed?: string): void {
  const config = defaultConfig()
  config.world.seed = seed && seed.trim() ? seed.trim() : randomSeed()
  const scenario = findScenario(ui.scenarioId)
  if (scenario) applyScenario(config, scenario)
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
