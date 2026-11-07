<script setup lang="ts">
/**
 * Species roster (milestone 4): every species that has ever arisen, alive or
 * extinct, with lineage, abundance and generation data. Clicking a row selects
 * the species for the map canvas. Read-only toward the simulation.
 */
import { computed } from 'vue'
import { getSim, selectSpecies, ui } from '../store'

const rows = computed(() => {
  const frame = ui.frame
  void frame
  const sim = getSim()
  return sim.species.species.map((s) => {
    const parent = sim.species.get(s.parentSpeciesId)
    return {
      id: s.id,
      name: s.name,
      diet: s.diet,
      generation: s.generation,
      splits: s.splits,
      members: s.memberCount,
      peak: s.peakPopulation,
      born: s.totalBorn,
      foundedTick: s.foundedTick,
      lastSeenTick: s.lastSeenTick,
      extinctionTick: s.extinctionTick,
      parentName: parent ? parent.name : null
    }
  })
})

function pick(id: number): void {
  selectSpecies(ui.selectedSpeciesId === id ? -1 : id)
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      Species
      <span class="subtle">({{ rows.length }} total, {{ rows.filter((r) => r.extinctionTick < 0).length }} alive)</span>
    </div>
    <table class="species-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Diet</th>
          <th>Gen</th>
          <th class="num">Pop</th>
          <th class="num">Peak</th>
          <th class="num">Born</th>
          <th class="num">Founded</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="r in rows"
          :key="r.id"
          :class="{ selected: ui.selectedSpeciesId === r.id, extinct: r.extinctionTick >= 0 }"
          @click="pick(r.id)"
        >
          <td>
            <em>{{ r.name }}</em>
            <div v-if="r.parentName" class="lineage">← {{ r.parentName }}</div>
          </td>
          <td><span class="diet" :class="'diet-' + r.diet">{{ r.diet }}</span></td>
          <td class="num">{{ r.generation }}</td>
          <td class="num">{{ r.extinctionTick < 0 ? r.members : '—' }}</td>
          <td class="num">{{ r.peak }}</td>
          <td class="num">{{ r.born }}</td>
          <td class="num">{{ r.foundedTick }}</td>
          <td>
            <span v-if="r.extinctionTick < 0" class="alive">alive</span>
            <span v-else class="dead">† tick {{ r.extinctionTick }}</span>
          </td>
        </tr>
      </tbody>
    </table>
    <div v-if="rows.length === 0" class="empty">No species yet — the world is sterile.</div>
  </section>
</template>

<style scoped>
.species-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.species-table th {
  text-align: left;
  color: #8b96a5;
  font-weight: 500;
  padding: 4px 6px;
  border-bottom: 1px solid #232a35;
}

.species-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #1d232e;
}

.species-table tbody tr {
  cursor: pointer;
}

.species-table tbody tr:hover {
  background: #1b212c;
}

.species-table tbody tr.selected {
  background: #213047;
}

.species-table tbody tr.extinct {
  opacity: 0.55;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.lineage {
  font-size: 10px;
  color: #8b96a5;
}

.diet {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  background: #232a35;
  color: #b8c2cc;
}

.diet-herbivore {
  background: #17351f;
  color: #6fce87;
}

.diet-omnivore {
  background: #382d16;
  color: #dfb257;
}

.diet-carnivore {
  background: #3a1d24;
  color: #e58095;
}

.alive {
  color: #6fce87;
}

.dead {
  color: #e58095;
}

.empty {
  color: #8b96a5;
  font-size: 13px;
  padding: 6px 2px;
}
</style>
