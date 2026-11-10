<script setup lang="ts">
/**
 * Time series charts (milestone 4): up to three census series overlaid on one
 * canvas so one metric can be read against another.
 *
 * Samples the engine's census series through `seriesSamples()` and draws up to
 * three metrics on one canvas. Read-only; redraws when new census data appears
 * or a new world is created.
 *
 * Overlays exist to read one question: does a diet class disappear because it
 * dies, or because its animals stop being that diet? That answer only appears
 * as a comparison — carnivores falling while omnivores rise and the population
 * holds. A shared scale compares magnitudes; a per-series scale compares
 * timing, which is what a 0-1 trait mean needs next to a head count.
 */
import { onBeforeUnmount, onMounted, computed, ref, watch } from 'vue'
import { getSim, ui } from '../store'
import { CHART_FIELDS } from '../sim/engine'
import { CENSUS_FIELD_LABELS } from '../sim/stats'
import type { CensusField } from '../sim/stats'

const MAX_SAMPLES = 600
const MAX_SERIES = 3

const CHART_COLORS: Partial<Record<CensusField, string>> = {
  population: '#48dbfb',
  herbivores: '#2ecc71',
  omnivores: '#f9ca24',
  carnivores: '#eb3455',
  meanDiet: '#b07cff',
  speciesAlive: '#1dd1a1',
  births: '#00d2d3',
  deaths: '#ff6348',
  temperature: '#e2725b',
  biomass: '#57b06a',
  meanEnergyRatio: '#8395a7',
  meanFitness: '#feca57',
  meanThermalOptimum: '#f368e0',
  thermalMismatch: '#e0a34e'
}

/** Fallbacks for census fields that are chartable but unlabelled. */
const FALLBACK_COLORS = ['#48dbfb', '#eb3455', '#f9ca24', '#1dd1a1', '#b07cff', '#ff6348']

const canvasEl = ref<HTMLCanvasElement | null>(null)
const primary = ref<CensusField>('population')
const overlays = ref<CensusField[]>([])
const sharedScale = ref(true)
const sampleCount = ref(0)
const legend = ref<{ field: CensusField; label: string; color: string; latest: string; span: string }[]>([])

let lastDrawnTick = -1

function labelFor(field: CensusField): string {
  return CENSUS_FIELD_LABELS[field] ?? field
}

function colorFor(field: CensusField, index: number): string {
  return CHART_COLORS[field] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length]
}

/**
 * Options for each "compare with" select: every metric not already on the
 * chart, plus that select's own current choice so it never drops its own value.
 */
const overlayOptions = computed<CensusField[][]>(() => {
  const taken = new Set(fields.value)
  return overlays.value.map(
    (current) => CHART_FIELDS.filter((f) => !taken.has(f) || f === current) as CensusField[]
  )
})

const fields = computed<CensusField[]>(() => [primary.value, ...overlays.value])

function setPrimary(event: Event): void {
  const select = event.target as HTMLSelectElement
  const field = select.value as CensusField
  if (!field) return
  overlays.value = overlays.value.filter((f) => f !== field)
  primary.value = field
  redraw()
}

function setOverlay(index: number, event: Event): void {
  const select = event.target as HTMLSelectElement
  const value = select.value
  if (value === '') overlays.value.splice(index, 1)
  else overlays.value[index] = value as CensusField
  redraw()
}

function addOverlay(): void {
  if (overlays.value.length >= MAX_SERIES - 1) return
  const taken = new Set(fields.value)
  const next = CHART_FIELDS.find((f) => !taken.has(f))
  if (!next) return
  overlays.value.push(next)
  redraw()
}

function removeOverlay(index: number): void {
  overlays.value.splice(index, 1)
  redraw()
}

function toggleScale(): void {
  sharedScale.value = !sharedScale.value
  redraw()
}

function redraw(): void {
  lastDrawnTick = -1
  draw()
}

interface Series {
  field: CensusField
  ticks: number[]
  values: number[]
  min: number
  max: number
}

/** Reads every selected series once; a series with fewer than two samples is
 *  still reported (so the legend can say "no data") but never drawn. */
function collectSeries(): Series[] {
  const sim = getSim()
  const out: Series[] = []
  for (const field of fields.value) {
    const samples = sim.seriesSamples(field, MAX_SAMPLES)
    const values = samples.values
    let min = Infinity
    let max = -Infinity
    for (const v of values) {
      if (v < min) min = v
      if (v > max) max = v
    }
    out.push({ field, ticks: samples.ticks, values, min, max })
  }
  return out
}

function draw(): void {
  const canvas = canvasEl.value
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const sim = getSim()

  const width = canvas.width
  const height = canvas.height
  ctx.fillStyle = '#10141c'
  ctx.fillRect(0, 0, width, height)

  const all = collectSeries()
  sampleCount.value = all.reduce((n, s) => Math.max(n, s.values.length), 0)
  const series = all.filter((s) => s.values.length >= 2)

  legend.value = all.map((s, i) => ({
    field: s.field,
    label: labelFor(s.field),
    color: colorFor(s.field, i),
    latest: format(sim.seriesLatest(s.field)),
    span: s.values.length ? `${format(s.min)} – ${format(s.max)}` : 'no data'
  }))

  if (series.length === 0) {
    ctx.fillStyle = '#8b96a5'
    ctx.font = '13px sans-serif'
    ctx.fillText('No data yet — run the simulation.', 12, height / 2)
    return
  }

  // One time domain across every series, so overlays stay readable even if a
  // buffer was trimmed differently from another.
  let t0 = Infinity
  let t1 = -Infinity
  for (const s of series) {
    if (s.ticks[0] < t0) t0 = s.ticks[0]
    const last = s.ticks[s.ticks.length - 1]
    if (last > t1) t1 = last
  }
  if (t1 <= t0) t1 = t0 + 1

  const padL = 52
  const padR = 8
  const padT = 10
  const padB = 18
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const xAt = (tick: number) => padL + ((tick - t0) / (t1 - t0)) * plotW

  // A shared axis compares how much; a per-series axis compares when.
  let axisMin = 0
  let axisMax = 1
  if (sharedScale.value) {
    axisMin = Infinity
    axisMax = -Infinity
    for (const s of series) {
      if (s.min < axisMin) axisMin = s.min
      if (s.max > axisMax) axisMax = s.max
    }
  }

  const yAt = (s: Series, v: number) => {
    let lo = axisMin
    let hi = axisMax
    if (!sharedScale.value || hi - lo < 1e-9) {
      lo = s.min
      hi = s.max
      if (hi - lo < 1e-9) {
        const pad = Math.max(1, Math.abs(lo) * 0.1)
        lo -= pad
        hi = lo + pad
      }
    }
    return padT + (1 - (v - lo) / (hi - lo)) * plotH
  }

  ctx.strokeStyle = '#232a35'
  ctx.fillStyle = '#8b96a5'
  ctx.font = '10px sans-serif'
  ctx.lineWidth = 1
  const gridLines = 4
  for (let g = 0; g <= gridLines; g++) {
    const y = padT + (plotH * g) / gridLines
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(width - padR, y)
    ctx.stroke()
    if (sharedScale.value) {
      const v = axisMax - ((axisMax - axisMin) * g) / gridLines
      ctx.fillText(format(v), 4, y + 3)
    }
  }

  for (const s of series) {
    const index = fields.value.indexOf(s.field)
    ctx.strokeStyle = colorFor(s.field, index)
    ctx.lineWidth = 1.6
    ctx.beginPath()
    for (let i = 0; i < s.values.length; i++) {
      const x = xAt(s.ticks[i])
      const y = yAt(s, s.values[i])
      if (i === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    }
    ctx.stroke()
  }

  ctx.fillStyle = '#8b96a5'
  ctx.fillText(`t ${Math.round(t0)} → ${Math.round(t1)}`, padL, height - 6)
  if (!sharedScale.value) {
    ctx.fillText('each series scaled to its own range', padL + 130, height - 6)
  }
}

function format(v: number): string {
  if (!Number.isFinite(v)) return '—'
  const abs = Math.abs(v)
  const digits = abs >= 100 ? 0 : abs >= 1 ? 1 : 3
  return v.toFixed(digits)
}

function drawIfNewData(): void {
  const sim = getSim()
  const tick = sim.lastCensus?.tick ?? -1
  if (tick !== lastDrawnTick) {
    lastDrawnTick = tick
    draw()
  }
}

watch(() => ui.frame, drawIfNewData)
watch(
  () => ui.epoch,
  () => {
    lastDrawnTick = -1
    draw()
  }
)

onMounted(draw)
onBeforeUnmount(() => {
  /* canvas refs are released by Vue */
})
</script>

<template>
  <section class="panel">
    <div class="panel-title">Time series</div>

    <div class="chart-controls">
      <label class="group-label" for="chart-field">Chart metric</label>
      <select id="chart-field" :value="primary" @change="setPrimary">
        <option v-for="field in CHART_FIELDS" :key="field" :value="field">
          {{ labelFor(field) }}
        </option>
      </select>
      <button @click="toggleScale">
        Scale: {{ sharedScale ? 'shared' : 'per series' }}
      </button>
      <span class="subtle">({{ sampleCount }} samples)</span>
    </div>

    <div v-for="(overlay, i) in overlays" :key="`overlay-${i}`" class="chart-controls">
      <label class="group-label" :for="`chart-overlay-${i}`">Compare with</label>
      <select :id="`chart-overlay-${i}`" :value="overlay" @change="setOverlay(i, $event)">
        <option value="">— none —</option>
        <option v-for="field in overlayOptions[i] ?? []" :key="field" :value="field">
          {{ labelFor(field) }}
        </option>
      </select>
      <button @click="removeOverlay(i)">Remove</button>
    </div>

    <div class="chart-controls">
      <button v-if="overlays.length < MAX_SERIES - 1" @click="addOverlay">Compare with another metric</button>
    </div>

    <ul class="legend">
      <li v-for="item in legend" :key="item.field">
        <span class="swatch" :style="{ background: item.color }"></span>
        <span>{{ item.label }}</span>
        <span class="legend-value">{{ item.latest }}</span>
        <span class="subtle">range {{ item.span }}</span>
      </li>
    </ul>

    <canvas ref="canvasEl" width="640" height="240" class="chart-canvas"></canvas>
  </section>
</template>

<style scoped>
.chart-controls {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 8px;
}

select {
  background: #232a35;
  color: #d7dee8;
  border: 1px solid #333c49;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 13px;
}

button {
  background: #232a35;
  color: #d7dee8;
  border: 1px solid #333c49;
  border-radius: 4px;
  padding: 6px 10px;
  font-size: 13px;
}

button:hover {
  background: #2c3542;
}

.group-label {
  font-size: 12px;
  color: #8b96a5;
}

.legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 4px 16px;
  padding: 0 0 8px 0;
  margin: 0;
}

.legend li {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  color: #d7dee8;
  font-variant-numeric: tabular-nums;
}

.swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 2px;
}

.legend-value {
  color: #ffffff;
  font-weight: 600;
}

.subtle {
  color: #8b96a5;
  font-size: 12px;
}

.chart-canvas {
  width: 100%;
  height: auto;
  display: block;
  border: 1px solid #2c333f;
  border-radius: 4px;
}
</style>
