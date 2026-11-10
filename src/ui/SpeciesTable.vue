<script setup lang="ts">
/**
 * Species roster (milestone 4): every species that has ever arisen, alive or
 * extinct, with lineage, abundance and generation data. Clicking a row selects
 * the species for the map canvas. Extinct species sharing a genus (the first
 * word of the binomial — the engine's makeName inherits it from the parent
 * species) collapse into one expandable group row, so long extinction runs do
 * not dominate the table. Read-only with respect to the simulation.
 */
import { computed, ref } from 'vue'
import { getSim, selectSpecies, ui } from '../store'

interface SpeciesRow {
  id: number
  name: string
  /** The genus: first word of the binomial, which makeName inherits. */
  genus: string
  diet: string
  generation: number
  splits: number
  members: number
  peak: number
  born: number
  foundedTick: number
  lastSeenTick: number
  extinctionTick: number
  parentName: string | null
}

type Entry =
  | { kind: 'species'; key: string; row: SpeciesRow }
  | {
      kind: 'group'
      key: string
      genus: string
      count: number
      diets: string[]
      maxGeneration: number
      peak: number
      born: number
      foundedTick: number
      lastExtinction: number
      members: SpeciesRow[]
    }

const expandedKeys = ref(new Set<string>())

const rows = computed(() => {
  const frame = ui.frame
  void frame
  const sim = getSim()
  return sim.species.species.map((s) => {
    const parent = sim.species.get(s.parentSpeciesId)
    return {
      id: s.id,
      name: s.name,
      genus: s.name.split(' ')[0],
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

const aliveCount = computed(() => rows.value.filter((r) => r.extinctionTick < 0).length)

const entries = computed<Entry[]>(() => {
  // Collect the extinct species by genus. A genus with a single extinct
  // species stays a plain row; only repeated extinctions collapse into a
  // group, so ordinary roster entries are untouched.
  const extinctByGenus = new Map<string, SpeciesRow[]>()
  for (const r of rows.value) {
    if (r.extinctionTick < 0) continue
    const list = extinctByGenus.get(r.genus)
    if (list) list.push(r)
    else extinctByGenus.set(r.genus, [r])
  }

  const out: Entry[] = []
  const emitted = new Set<string>()
  for (const r of rows.value) {
    if (r.extinctionTick < 0) {
      out.push({ kind: 'species', key: `s${r.id}`, row: r })
      continue
    }
    const group = extinctByGenus.get(r.genus)!
    if (group.length === 1) {
      out.push({ kind: 'species', key: `s${r.id}`, row: r })
      continue
    }
    if (emitted.has(r.genus)) continue
    emitted.add(r.genus)
    out.push({
      kind: 'group',
      key: `g${r.genus}`,
      genus: r.genus,
      count: group.length,
      diets: [...new Set(group.map((m) => m.diet))],
      maxGeneration: group.reduce((m, g) => Math.max(m, g.generation), 0),
      peak: group.reduce((sum, g) => sum + g.peak, 0),
      born: group.reduce((sum, g) => sum + g.born, 0),
      foundedTick: group.reduce((m, g) => Math.min(m, g.foundedTick), Number.POSITIVE_INFINITY),
      lastExtinction: group.reduce((m, g) => Math.max(m, g.extinctionTick), 0),
      members: group
    })
  }
  return out
})

function isExpanded(key: string): boolean {
  return expandedKeys.value.has(key)
}

function toggleGroup(key: string): void {
  const next = new Set(expandedKeys.value)
  if (next.has(key)) next.delete(key)
  else next.add(key)
  expandedKeys.value = next
}

function pick(id: number): void {
  selectSpecies(ui.selectedSpeciesId === id ? -1 : id)
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">
      Species
      <span class="subtle">({{ rows.length }} total, {{ aliveCount }} alive)</span>
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
        <template v-for="entry in entries" :key="entry.key">
          <tr
            v-if="entry.kind === 'species'"
            :class="{ selected: ui.selectedSpeciesId === entry.row.id, extinct: entry.row.extinctionTick >= 0 }"
            @click="pick(entry.row.id)"
          >
            <td>
              <em>{{ entry.row.name }}</em>
              <div v-if="entry.row.parentName" class="lineage">← {{ entry.row.parentName }}</div>
            </td>
            <td><span class="diet" :class="'diet-' + entry.row.diet">{{ entry.row.diet }}</span></td>
            <td class="num">{{ entry.row.generation }}</td>
            <td class="num">{{ entry.row.extinctionTick < 0 ? entry.row.members : '—' }}</td>
            <td class="num">{{ entry.row.peak }}</td>
            <td class="num">{{ entry.row.born }}</td>
            <td class="num">{{ entry.row.foundedTick }}</td>
            <td>
              <span v-if="entry.row.extinctionTick < 0" class="alive">alive</span>
              <span v-else class="dead">† tick {{ entry.row.extinctionTick }}</span>
            </td>
          </tr>

          <template v-else>
            <tr class="genus" @click="toggleGroup(entry.key)">
              <td>
                <span class="caret">{{ isExpanded(entry.key) ? '▾' : '▸' }}</span>
                <em class="extinct-name">† {{ entry.genus }}</em>
                <span class="subtle"> {{ entry.count }} extinct species</span>
              </td>
              <td>
                <span
                  v-for="diet in entry.diets"
                  :key="entry.key + ':' + diet"
                  class="diet"
                  :class="'diet-' + diet"
                >{{ diet }}</span>
              </td>
              <td class="num">{{ entry.maxGeneration }}</td>
              <td class="num">—</td>
              <td class="num">{{ entry.peak }}</td>
              <td class="num">{{ entry.born }}</td>
              <td class="num">{{ entry.foundedTick }}</td>
              <td><span class="dead">† last at tick {{ entry.lastExtinction }}</span></td>
            </tr>
            <tr
              v-for="m in entry.members"
              v-show="isExpanded(entry.key)"
              :key="entry.key + ':' + String(m.id)"
              class="member"
              :class="{ selected: ui.selectedSpeciesId === m.id }"
              @click="pick(m.id)"
            >
              <td>
                <em>{{ m.name }}</em>
                <div v-if="m.parentName" class="lineage">← {{ m.parentName }}</div>
              </td>
              <td><span class="diet" :class="'diet-' + m.diet">{{ m.diet }}</span></td>
              <td class="num">{{ m.generation }}</td>
              <td class="num">—</td>
              <td class="num">{{ m.peak }}</td>
              <td class="num">{{ m.born }}</td>
              <td class="num">{{ m.foundedTick }}</td>
              <td><span class="dead">† tick {{ m.extinctionTick }}</span></td>
            </tr>
          </template>
        </template>
      </tbody>
    </table>
    <div v-if="rows.length === 0" class="empty">No species yet — the world is sterile.</div>
  </section>
</template>

<style scoped>
.species-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
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
  border-bottom: 1px solid #232a35;
  vertical-align: top;
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

.species-table tbody tr.member {
  opacity: 0.75;
}

.species-table tbody tr.member td:first-child {
  padding-left: 28px;
}

tr.genus {
  background: #1a2028;
}

tr.genus:hover {
  background: #232a35;
}

.caret {
  display: inline-block;
  width: 1.2em;
  color: #8b96a5;
}

.extinct-name {
  color: #b8c2cc;
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
  color: #7fce8b;
}

.diet-omnivore {
  background: #352c1d;
  color: #dfb257;
}

.diet-carnivore {
  background: #3a1d24;
  color: #e58095;
}

.alive {
  color: #7fce8b;
}

.dead {
  color: #e58095;
}

.subtle {
  color: #8b96a5;
  font-size: 12px;
}

.empty {
  color: #8b96a5;
  font-size: 12px;
}
</style>
