<script setup lang="ts">
/**
 * Live statistics panel (milestone 4): current census, population breakdown,
 * evolutionary averages, and the energy audit. Read-only: the panel samples
 * the simulation each time `ui.frame` advances and never mutates it.
 */
import { computed } from 'vue'
import { getSim, ui } from '../store'
import { DEATH_CAUSES } from '../sim/types'

const snap = computed(() => {
  const frame = ui.frame
  void frame
  const sim = getSim()
  const census = sim.lastCensus
  const audit = sim.auditEnergy()
  const deaths = DEATH_CAUSES.map((cause) => ({ cause, count: sim.deathsByCause[cause] }))
  const totalDeaths = deaths.reduce((sum, d) => sum + d.count, 0)
  return {
    tick: sim.tick,
    seasonName: sim.season.name,
    cap: ui.populationCap,
    census,
    audit,
    deaths,
    totalDeaths
  }
})

const driftOk = computed(() => Math.abs(snap.value.audit.delta) < 1e-6 * Math.max(1, snap.value.audit.total))

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function fmtInt(n: number): string {
  return Math.round(n).toLocaleString('en')
}
</script>

<template>
  <section class="panel">
    <div class="panel-title">Live census — tick {{ snap.tick }} · {{ snap.seasonName }}</div>

    <div v-if="!snap.census" class="empty">
      No census yet. Run the simulation to collect data.
    </div>

    <template v-else>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Population / cap</div>
          <div class="stat-value">{{ fmtInt(snap.census.population) }} / {{ fmtInt(snap.cap) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Species alive</div>
          <div class="stat-value">{{ snap.census.speciesAlive }} / {{ snap.census.speciesTotal }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Mean temperature</div>
          <div class="stat-value">{{ fmt(snap.census.temperature) }} °C</div>
        </div>
        <div class="stat">
          <div class="stat-label">Plant biomass</div>
          <div class="stat-value">{{ fmtInt(snap.census.biomass) }} E</div>
        </div>
      </div>

      <h4>Diet composition</h4>
      <div class="bar-row">
        <div class="bar-label">Herbivores</div>
        <div class="bar"><div class="bar-fill herb" :style="{ width: snap.census.population ? (snap.census.herbivores / snap.census.population) * 100 + '%' : '0%' }"></div></div>
        <div class="bar-num">{{ fmtInt(snap.census.herbivores) }}</div>
      </div>
      <div class="bar-row">
        <div class="bar-label">Omnivores</div>
        <div class="bar"><div class="bar-fill omni" :style="{ width: snap.census.population ? (snap.census.omnivores / snap.census.population) * 100 + '%' : '0%' }"></div></div>
        <div class="bar-num">{{ fmtInt(snap.census.omnivores) }}</div>
      </div>
      <div class="bar-row">
        <div class="bar-label">Carnivores</div>
        <div class="bar"><div class="bar-fill carniv" :style="{ width: snap.census.population ? (snap.census.carnivores / snap.census.population) * 100 + '%' : '0%' }"></div></div>
        <div class="bar-num">{{ fmtInt(snap.census.carnivores) }}</div>
      </div>

      <h4>Evolutionary averages</h4>
      <div class="stat-grid">
        <div class="stat">
          <div class="stat-label">Mean body size</div>
          <div class="stat-value">{{ fmt(snap.census.meanSize, 2) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Mean metabolism</div>
          <div class="stat-value">{{ fmt(snap.census.meanMetabolism, 2) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Mean lifespan</div>
          <div class="stat-value">{{ fmt(snap.census.meanLifespan, 0) }} t</div>
        </div>
        <div class="stat">
          <div class="stat-label">Mean thermal optimum</div>
          <div class="stat-value">{{ fmt(snap.census.meanThermalOptimum) }} °C</div>
        </div>
        <div class="stat">
          <div class="stat-label">Thermal mismatch</div>
          <div class="stat-value" :class="{ warn: snap.census.thermalMismatch > 5 }">
            {{ fmt(snap.census.thermalMismatch) }} °C
          </div>
        </div>
        <div class="stat">
          <div class="stat-label">Fitness (offspring)</div>
          <div class="stat-value">{{ fmt(snap.census.meanFitness, 2) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Births / tick</div>
          <div class="stat-value">{{ fmtInt(snap.census.births) }}</div>
        </div>
        <div class="stat">
          <div class="stat-label">Deaths / tick</div>
          <div class="stat-value">{{ fmtInt(snap.census.deaths) }}</div>
        </div>
      </div>

      <h4>Deaths by cause (cumulative)</h4>
      <table class="small-table">
        <tbody>
          <tr v-for="row in snap.deaths" :key="row.cause">
            <td>{{ row.cause }}</td>
            <td class="num">{{ fmtInt(row.count) }}</td>
            <td class="num subtle">
              {{ snap.totalDeaths > 0 ? fmt((row.count / snap.totalDeaths) * 100, 0) + '%' : '—' }}
            </td>
          </tr>
        </tbody>
      </table>

      <h4>Energy audit</h4>
      <table class="small-table">
        <tbody>
          <tr><td>Biomass (living plants)</td><td class="num">{{ fmt(snap.audit.biomass, 0) }} E</td></tr>
          <tr><td>Detritus</td><td class="num">{{ fmt(snap.audit.detritus, 0) }} E</td></tr>
          <tr><td>Creatures</td><td class="num">{{ fmt(snap.audit.creatures, 0) }} E</td></tr>
          <tr class="total-row"><td>Total</td><td class="num">{{ fmt(snap.audit.total, 0) }} E</td></tr>
          <tr>
            <td>Drift from conserved total</td>
            <td class="num" :class="driftOk ? 'ok' : 'warn'">
              {{ fmt(snap.audit.delta, 3) }} E
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.stat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 8px;
  margin-bottom: 10px;
}

.stat {
  background: #131720;
  border: 1px solid #232a35;
  border-radius: 5px;
  padding: 8px;
}

.stat-label {
  font-size: 11px;
  color: #8b96a5;
}

.stat-value {
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  margin-top: 3px;
}

h4 {
  margin: 12px 0 6px;
  font-size: 12px;
  color: #8b96a5;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.bar-row {
  display: grid;
  grid-template-columns: 90px 1fr 60px;
  align-items: center;
  gap: 8px;
  margin: 4px 0;
  font-size: 12px;
}

.bar-label {
  color: #b8c2cc;
}

.bar {
  height: 10px;
  background: #131720;
  border-radius: 5px;
  overflow: hidden;
}

.bar-fill {
  height: 100%;
  transition: width 0.2s;
}

.bar-fill.herb {
  background: #57b06a;
}

.bar-fill.omni {
  background: #d0a038;
}

.bar-fill.carniv,
.bar-fill.carn {
  background: #c25b4e;
}

.bar-num {
  text-align: right;
  font-variant-numeric: tabular-nums;
  color: #d7dee8;
}

.small-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
}

.small-table td {
  padding: 4px 6px;
  border-bottom: 1px solid #1d232e;
}

.num {
  text-align: right;
  font-variant-numeric: tabular-nums;
}

.total-row td {
  font-weight: 600;
}

.ok {
  color: #57b06a;
}

.warn {
  color: #e0a34e;
}

.subtle {
  color: #8b96a5;
}

.empty {
  color: #8b96a5;
  font-size: 13px;
  padding: 8px 0;
}
</style>
