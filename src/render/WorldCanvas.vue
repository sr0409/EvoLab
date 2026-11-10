<script setup lang="ts">
/**
 * World map renderer (milestone 4).
 *
 * Draws the simulation state into a canvas as fast pixel data: a one-tile-per-
 * pixel ImageData at world resolution, upscaled to the display canvas with
 * smoothing disabled. The component never mutates the simulation; it redraws
 * whenever `ui.frame`, the selected map view, the selected species, or the
 * world epoch changes.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getSim, ui } from '../store'
import { isLandTerrain } from '../sim/types'

const SCALE = 4

/** Fixed palette indexed by terrain id (see src/sim/types.ts). */
const terrainRGB: [number, number, number][] = [
  [10, 46, 92], // deep water
  [22, 80, 140], // water
  [185, 160, 106], // shore
  [110, 79, 47], // bare soil
  [63, 143, 58], // grassland
  [47, 110, 53], // scrubland
  [29, 84, 38], // forest
  [138, 143, 152] // rock
]

/** Distinct colors for species dots, cycled by species id. */
const speciesColors = [
  '#ff6b6b', '#feca57', '#48dbfb', '#1dd1a1', '#f368e0', '#ff9f43', '#54a0ff', '#00d2d3',
  '#ee5253', '#a29bfe', '#ffeaa7', '#55efc4', '#fd79a8', '#81ecec', '#e17055', '#74b9ff'
]

const canvasEl = ref<HTMLCanvasElement | null>(null)

let ctx: CanvasRenderingContext2D | null = null
let off: HTMLCanvasElement | null = null
let offCtx: CanvasRenderingContext2D | null = null
let image: ImageData | null = null

function ensureBuffers(): boolean {
  const canvas = canvasEl.value
  if (!canvas) return false
  const sim = getSim()
  const w = sim.world
  if (off && off.width !== w.width) {
    off = null
    offCtx = null
    image = null
    ctx = null
  }
  if (!off) {
    off = document.createElement('canvas')
    off.width = w.width
    off.height = w.height
    offCtx = off.getContext('2d')
    image = new ImageData(w.width, w.height)
    canvas.width = w.width * SCALE
    canvas.height = w.height * SCALE
    ctx = canvas.getContext('2d')
  }
  return ctx !== null && offCtx !== null && image !== null
}

function drawTiles(): void {
  const sim = getSim()
  const w = sim.world
  const data = image!.data
  const size = w.size
  const view = ui.mapView

  if (view === 'temperature') {
    // Blue (cold) to red (hot) over -30..45 °C.
    for (let i = 0; i < size; i++) {
      const k = Math.max(0, Math.min(255, Math.round((w.temperature[i] + 30) * 3.4)))
      const o = i * 4
      data[o] = 30 + k
      data[o + 1] = 45
      data[o + 2] = 235 - k
      data[o + 3] = 255
    }
    return
  }

  for (let i = 0; i < size; i++) {
    const terrain = w.terrain[i]
    const base = terrainRGB[terrain] ?? terrainRGB[0]
    let r = base[0]
    let g = base[1]
    let b = base[2]
    if (view === 'biomass' && isLandTerrain(terrain)) {
      // Darkened terrain, green intensity showing how full the site is.
      const cap = w.capacity[i]
      const ratio = cap > 0 ? Math.min(1, w.biomass[i] / cap) : 0
      r = base[0] * 0.35
      g = base[1] * 0.35 + 170 * ratio
      b = base[2] * 0.35
    }
    const o = i * 4
    data[o] = r
    data[o + 1] = g
    data[o + 2] = b
    data[o + 3] = 255
  }
}

function drawCreatures(): void {
  const c = ctx!
  const sim = getSim()
  const selected = ui.selectedSpeciesId
  for (const cr of sim.creatures) {
    if (!cr.alive) continue
    const isSelected = cr.speciesId === selected
    if (selected >= 0 && !isSelected) continue
    const color = speciesColors[cr.speciesId % speciesColors.length]
    const x = cr.x * SCALE
    const y = cr.y * SCALE
    if (isSelected) {
      c.fillStyle = '#ffffff'
      c.fillRect(x - 1, y - 1, SCALE + 2, SCALE + 2)
    }
    c.fillStyle = color
    c.fillRect(x, y, SCALE, SCALE)
  }
}

function draw(): void {
  if (!ensureBuffers()) return
  drawTiles()
  offCtx!.putImageData(image!, 0, 0)
  const c = ctx!
  c.imageSmoothingEnabled = false
  const canvas = canvasEl.value!
  c.drawImage(off!, 0, 0, canvas.width, canvas.height)
  drawCreatures()
}

watch(() => ui.frame, draw)
watch(() => ui.mapView, draw)
watch(() => ui.selectedSpeciesId, draw)
watch(
  () => ui.epoch,
  () => {
    off = null
    draw()
  }
)

onMounted(draw)

onBeforeUnmount(() => {
  ctx = null
  off = null
  offCtx = null
  image = null
})
</script>

<template>
  <div class="panel world-canvas">
    <div class="panel-title">World map</div>
    <canvas ref="canvasEl" class="world-canvas-inner"></canvas>
  </div>
</template>

<style scoped>
.world-canvas {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.world-canvas-inner {
  width: 100%;
  height: auto;
  display: block;
  border: 1px solid #2c333d;
  border-radius: 4px;
  background: #0a0e14;
}
</style>
