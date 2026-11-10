<script setup lang="ts">
/**
 * Top control bar (milestone 4): run controls, speed, seed, scenario presets,
 * the manual population ceiling and the quarry-energy floor knob (milestone 9),
 * and map view selection. All state lives in the store; this component only
 * forwards user intent to it.
 */
import { computed, ref } from 'vue'
import {
  SPEED_PRESETS,
  getSim,
  newWorld,
  resetMinPreyEnergy,
  resetPopulationCap,
  selectScenario,
  setMapView,
  setMinPreyEnergy,
  setPopulationCap,
  setSpeed,
  stepOnce,
  toggleRunning,
  ui
} from '../store'
import type { MapView } from '../store'
import { MIN_PREY_ENERGY_LIMITS, POPULATION_CAP_LIMITS, SCENARIOS } from '../sim/config'

const seedInput = ref('')

/** Read-only status readout, refreshed whenever the simulation advances. */
const readout = computed(() => {
  const frame = ui.frame
  void frame
  const sim = getSim()
  return {
    tick: sim.tick,
    seed: sim.config.world.seed,
    season: sim.season.name,
    creatures: sim.size,
    cap: ui.populationCap
  }
})

const MAP_VIEWS: { id: MapView; label: string }[] = [
  { id: 'terrain', label: 'Terrain' },
  { id: 'biomass', label: 'Biomass' },
  { id: 'temperature', label: 'Temperature' }
]

function onScenarioChange(event: Event): void {
  const select = event.target as HTMLSelectElement
  selectScenario(select.value)
  if (getSim().tick > 0) newWorld()
}

function onSpeedChange(event: Event): void {
  const select = event.target as HTMLSelectElement
  setSpeed(Number(select.value))
}

/**
 * Apply a manually entered population ceiling to the running world. The store
 * clamps it to POPULATION_CAP_LIMITS, and the input is re-rendered with the
 * value the simulation is actually using.
 */
function onCapChange(event: Event): void {
  const input = event.target as HTMLInputElement
  setPopulationCap(Number(input.value))
}

/**
 * Apply a manually entered quarry-energy floor. The store clamps it to
 * MIN_PREY_ENERGY_LIMITS, and the input is re-rendered with the value the
 * simulation is actually using.
 */
function onMinPreyEnergyChange(event: Event): void {
  const input = event.target as HTMLInputElement
  setMinPreyEnergy(Number(input.value))
}

function createWorld(): void {
  newWorld(seedInput.value.trim() || undefined)
}
</script>

<template>
  <header class="control-bar">
    <div class="group">
      <button class="primary" @click="toggleRunning()">
        {{ ui.running ? 'Pause' : 'Run' }}
      </button>
      <button @click="stepOnce()">Step</button>
      <select :value="ui.speedIndex" @change="onSpeedChange" title="Simulation speed">
        <option v-for="(preset, index) in SPEED_PRESETS" :key="index" :value="index">
          Speed {{ preset.ticksPerSecond }} tps
        </option>
      </select>
    </div>

    <div class="group">
      <input
        v-model="seedInput"
        class="seed"
        type="text"
        :placeholder="`seed: ${getSim().config.world.seed}`"
      />
      <button @click="createWorld()">New world</button>
    </div>

    <div class="group">
      <label class="group-label">Scenario</label>
      <select :value="ui.scenarioId" @change="onScenarioChange">
        <option value="">— none —</option>
        <option v-for="scenario in SCENARIOS" :key="scenario.id" :value="scenario.id">
          {{ scenario.label }}
        </option>
      </select>
    </div>

    <div class="group">
      <label class="group-label" for="population-cap">Population cap</label>
      <input
        id="population-cap"
        class="cap"
        type="number"
        :value="ui.populationCap"
        :min="POPULATION_CAP_LIMITS.min"
        :max="POPULATION_CAP_LIMITS.max"
        step="10"
        title="Hard ceiling on living creatures. Breeding stops at the ceiling; it takes effect on the running world immediately."
        @change="onCapChange"
      />
      <button @click="resetPopulationCap()" title="Restore the default population ceiling">Default</button>
    </div>

    <div class="group">
      <label class="group-label" for="min-prey-energy">Prey energy floor</label>
      <input
        id="min-prey-energy"
        class="energy"
        type="number"
        :value="Number(ui.minPreyEnergy.toFixed(2))"
        :min="MIN_PREY_ENERGY_LIMITS.min"
        :max="MIN_PREY_ENERGY_LIMITS.max"
        step="0.05"
        title="Energy floor for legal quarry (engine gate prey.energy > 0.2). Raising it means only well-fed animals can be hunted; it takes effect on the running world immediately."
        @change="onMinPreyEnergyChange"
      />
      <button @click="resetMinPreyEnergy()" title="Restore the engine's original quarry gate (0.2)">Default</button>
    </div>

    <div class="group">
      <label class="group-label">Map view</label>
      <div class="segmented">
        <button
          v-for="view in MAP_VIEWS"
          :key="view.id"
          :class="{ active: ui.mapView === view.id }"
          @click="setMapView(view.id)"
        >
          {{ view.label }}
        </button>
      </div>
    </div>

    <div class="group readout">
      <span>tick {{ readout.tick }}</span>
      <span>seed: {{ readout.seed }}</span>
      <span>season: {{ readout.season }}</span>
      <span>{{ readout.creatures }} / {{ readout.cap }} creatures</span>
    </div>
  </header>
</template>

<style scoped>
.control-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 14px;
  padding: 10px 14px;
  background: #171c24;
  border: 1px solid #2c333d;
  border-radius: 6px;
}

.group {
  display: flex;
  align-items: center;
  gap: 6px;
}

.group-label {
  font-size: 12px;
  color: #8b96a5;
}

button,
select,
input {
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

button.primary {
  background: #2b6f46;
  border-color: #38875a;
}

button.primary:hover {
  background: #348257;
}

button.active {
  background: #2f5f8a;
  border-color: #3d77ab;
}

.seed {
  width: 140px;
}

.cap {
  width: 78px;
}

.energy {
  width: 70px;
}

.segmented {
  display: flex;
  gap: 0;
}

.segmented button {
  border-radius: 0;
}

.segmented button:first-child {
  border-radius: 4px 0 0 4px;
}

.segmented button:last-child {
  border-radius: 0 4px 4px 0;
}

.readout {
  margin-left: auto;
  font-size: 12px;
  color: #8b96a5;
  gap: 12px;
}
</style>
