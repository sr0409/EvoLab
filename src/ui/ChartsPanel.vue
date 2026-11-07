<script setup lang="ts">
/**
 * Time-series charts (milestone 4).
 *
 * Samples the engine's census series through `seriesSamples()` and draws a
 * line chart on a canvas. Read-only; redraws when new census data appears or
 * a new world is created.
 */
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { getSim, ui } from '../store'
import { CHART_FIELDS } from '../sim/engine'
import { CENSUS_FIELD_LABELS } from '../sim/stats'
import type { CensusField } from '../sim/stats'

const CHART_COLORS: Record<string, string> = {
  population: '#48dbfb',
  speciesAlive: '#1dd1a1',
  temperature: '#e2725b',
  biomass: '#57b06a',
  meanFitness: '#feca57',
  meanThermalOptimum: '#f368e0',
  thermalMismatch: '#e0a34e'
}

const MAX_SAMPLES = 600

const canvasEl = ref<HTMLCanvasElement | null>(null)
const selectedField = ref<CensusField>('population')
const latestValue = ref<string>('—')
const sampleCount = ref(0)

let lastDrawnTick = -1

function labelFor(field: CensusField): string {
  return CENSUS_FIELD_LABELS[field] ?? field
}

function onFieldChange(event: Event): void {
  const select = event.target as HTMLSelectElement
  selectedField.value = select.value as CensusField
  lastDrawnTick = -1
  draw()
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

  const samples = sim.seriesSamples(selectedField.value, MAX_SAMPLES)
  const values = samples.values
  sampleCount.value = values.length

  if (sim.lastCensus) {
    const raw = (sim.lastCensus as unknown as Record<string, number>)[selectedField.value]
    latestValue.value = typeof raw === 'number' ? format(raw) : '—'
  } else {
    latestValue.value = '—'
  }

  if (values.length < 2) {
    ctx.fillStyle = '#8b96a5'
    ctx.font = '13px sans-serif'
    ctx.fillText('No data yet — run the simulation.', 12, height / 2)
    return
  }

  let min = Infinity
  let max = -Infinity
  for (const v of values) {
    if (v < min) min = v
    if (v > max) max = v
  }
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.1)
    min -= pad
    max += pad
  }

  const padL = 52
  const padR = 8
  const padT = 10
  const padB = 18
  const plotW = width - padL - padR
  const plotH = height - padT - padB

  const xAt = (i: number) => padL + (i / (values.length - 1)) * plotW
  const yAt = (v: number) => padT + (1 - (v - min) / (max - min)) * plotH

  // Grid lines and axis labels
  ctx.strokeStyle = '#232a35'
  ctx.fillStyle = '#8b96a5'
  ctx.font = '10px sans-serif'
  ctx.lineWidth = 1
  const gridLines = 4
  for (let g = 0; g <= gridLines; g++) {
    const v = min + ((max - min) * g) / gridLines
    const y = yAt(v)
    ctx.beginPath()
    ctx.moveTo(padL, y)
    ctx.lineTo(width - padR, y)
    ctx.stroke()
    ctx.fillText(format(v), 4, y + 3)
  }

  // Series line
  ctx.strokeStyle = CHART_COLORS[selectedField.value] ?? '#48dbfb'
  ctx.lineWidth = 1.6
  ctx.beginPath()
  for (let i = 0; i < values.length; i++) {
    const x = xAt(i)
    const y = yAt(values[i])
    if (i === 0) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
  }
  ctx.stroke()

  // Range labels
  ctx.fillStyle = '#8b96a5'
  ctx.fillText(
    `t ${samples.ticks[0]} → ${samples.ticks[samples.ticks.length - 1]}`,
    padL,
    height - 6
  )
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
      <select :value="selectedField" @change="onFieldChange">
        <option v-for="field in CHART_FIELDS" :key="field" :value="field">
          {{ labelFor(field) }}
        </option>
      </select>
      <span class="latest">
        latest: <strong>{{ latestValue }}</strong>
        <span class="subtle">({{ sampleCount }} samples)</span>
      </span>
    </div>

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

.latest {
  font-size: 13px;
  color: #d7dee8;
  font-variant-numeric: tabular-nums;
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
