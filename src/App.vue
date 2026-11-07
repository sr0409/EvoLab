<script setup lang="ts">
/**
 * EvoLab application shell (milestone 4).
 *
 * Owns the simulation loop lifecycle: the store's tick loop starts on mount
 * and stops on unmount. Layout: world canvas and charts on the left, live
 * stats, species roster and event log on the right.
 */
import { onBeforeUnmount, onMounted } from 'vue'
import { startLoop, stopLoop } from './store'
import ControlBar from './ui/ControlBar.vue'
import WorldCanvas from './render/WorldCanvas.vue'
import StatsPanel from './ui/StatsPanel.vue'
import ChartsPanel from './ui/ChartsPanel.vue'
import SpeciesTable from './ui/SpeciesTable.vue'
import EventLog from './ui/EventLog.vue'

onMounted(startLoop)
onBeforeUnmount(stopLoop)
</script>

<template>
  <div class="app">
    <h1 class="brand">EvoLab <span>emergent evolution sandbox</span></h1>
    <ControlBar />

    <main class="layout">
      <div class="col col-left">
        <WorldCanvas />
        <ChartsPanel />
      </div>
      <div class="col col-right">
        <StatsPanel />
        <SpeciesTable />
        <EventLog />
      </div>
    </main>
  </div>
</template>

<style>
* {
  box-sizing: border-box;
}

html,
body {
  margin: 0;
  padding: 0;
  background: #0d1017;
  color: #d7dee8;
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
}

.app {
  max-width: 1380px;
  margin: 0 auto;
  padding: 14px 16px 28px;
}

.brand {
  font-size: 17px;
  margin: 4px 0 10px;
  letter-spacing: 0.02em;
}

.brand span {
  font-size: 12px;
  font-weight: 400;
  color: #8b96a5;
  margin-left: 8px;
}

.layout {
  display: grid;
  grid-template-columns: minmax(420px, 700px) minmax(380px, 1fr);
  gap: 14px;
  align-items: start;
  margin-top: 14px;
}

.col {
  display: flex;
  flex-direction: column;
  gap: 14px;
  min-width: 0;
}

@media (max-width: 1000px) {
  .layout {
    grid-template-columns: 1fr;
  }
}
</style>
