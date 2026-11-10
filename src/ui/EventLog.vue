<script setup lang="ts">
/**
 * Rolling log of notable world events (milestone 4): speciation, extinction,
 * population crashes, food collapse and climate markers. Read-only — events
 * are pulled from the simulation each time the frame counter advances.
 */
import { computed } from 'vue'
import { getSim, ui } from '../store'

const MAX_ROWS = 120

const events = computed(() => {
  const frame = ui.frame
  void frame
  const sim = getSim()
  const rows: { seq: number; tick: number; kind: string; message: string }[] = []
  const list = sim.events
  for (let i = list.length - 1; i >= 0 && rows.length < MAX_ROWS; i--) {
    const e = list[i]
    rows.push({ seq: e.seq, tick: e.tick, kind: e.kind, message: e.message })
  }
  return rows
})
</script>

<template>
  <section class="panel">
    <div class="panel-title">Event log</div>
    <div class="event-list">
      <div v-if="events.length === 0" class="empty">
        No events recorded yet.
      </div>
      <div v-for="e in events" :key="e.seq" class="event-row">
        <span class="event-tick">{{ e.tick }}</span>
        <span class="event-kind" :class="'kind-' + e.kind">{{ e.kind }}</span>
        <span class="event-message">{{ e.message }}</span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.event-list {
  max-height: 300px;
  overflow-y: auto;
  font-size: 12px;
}

.event-row {
  display: grid;
  grid-template-columns: 52px 110px 1fr;
  gap: 8px;
  padding: 4px 2px;
  border-bottom: 1px solid #1d232e;
  align-items: baseline;
}

.event-tick {
  color: #8b96a5;
  font-variant-numeric: tabular-nums;
  text-align: right;
}

.event-kind {
  text-transform: lowercase;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: #232a35;
  color: #b8c2cc;
  white-space: nowrap;
}

.kind-speciation {
  background: #17351f;
  color: #6fce87;
}

.kind-extinction {
  background: #3a1d24;
  color: #e58095;
}

.kind-population_crash {
  background: #3a2a1d;
  color: #e0a34e;
}

.kind-population_boom {
  background: #16303f;
  color: #6cc5e8;
}

.kind-food_collapse {
  background: #33202b;
  color: #d88fb0;
}

.kind-climate {
  background: #241f3b;
  color: #a99ad8;
}

.kind-system {
  background: #232a35;
  color: #b8c2cc;
}

.event-message {
  color: #d7dee8;
}

.empty {
  color: #8b96a5;
  padding: 6px 2px;
}
</style>
