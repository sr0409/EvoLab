import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { DEATH_CAUSES, type DeathCause } from '../src/sim/types'

// Diagnostic scratch probe (not part of the test suite): the founder-band
// thermal load, measured with the engine's own thermoregulation terms
// (updateCreature in src/sim/engine.ts). Used to decide candidate (e) in
// PROGRESS.md section 8: seed the founders with a thermal optimum matched to
// their spawn-tile temperature instead of the fixed per-diet default.
//
//   npx tsx tests/scratch-founder-thermal.ts
//
// Measures, per seed:
//   1. the founder carnivores' spawn deviation |spawnTileTemp - optimum| at t = 0;
//   2. every 250 ticks: the meat band's count, its mean thermal deviation, and
//      the engine's regulatory cost term summed over the band;
//   3. deaths per interval, by cause.

const SEEDS = ['evolab', 'evolab-2', 'evolab-3']
const CHUNK = 250
const TICKS = 3000

function runSeed(seed: string): void {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  // --- the founder carnivores at t = 0: what the engine actually gave them ---
  const founderIds = new Set<number>()
  const spawnDevs: number[] = []
  for (const c of sim.creatures) {
    if (!(c.phenotype.diet > 0.66)) continue
    founderIds.add(c.id)
    const tile = Math.floor(c.y) * sim.world.width + Math.floor(c.x)
    const temp = sim.world.temperature[tile]!
    spawnDevs.push(Math.abs(temp - c.phenotype.thermalOptimum))
  }

  const meanSpawnDev = spawnDevs.length > 0 ? spawnDevs.reduce((a, b) => a + b, 0) / spawnDevs.length : 0
  const maxSpawnDev = spawnDevs.length > 0 ? Math.max(...spawnDevs) : 0
  console.log('--- seed ' + seed + ' ---')
  console.log('founder carnivores: ' + founderIds.size + ' | spawn deviation mean=' + meanSpawnDev.toFixed(1) + ' max=' + maxSpawnDev.toFixed(1))

  const prevDeaths = Object.fromEntries(DEATH_CAUSES.map((cause) => [cause, 0])) as Record<
    DeathCause,
    number
  >

  for (let tick = CHUNK; tick <= TICKS; tick += CHUNK) {
    sim.run(CHUNK)

    // --- the meat band, sampled with the engine's own thermal terms ---------
    let bandCount = 0
    let devSum = 0
    let costSum = 0
    for (const c of sim.creatures) {
      if (!(c.phenotype.diet > 0.66)) continue
      bandCount += 1
      const dev = Math.abs(c.localTemperature - c.phenotype.thermalOptimum)
      const cost = 0.02 * Math.max(0, dev - 0.35 * c.phenotype.thermalTolerance) * Math.pow(c.phenotype.mass, 0.4)
      devSum += dev
      costSum += cost
    }

    let causes = ''
    for (const cause of DEATH_CAUSES) {
      const delta = sim.deathsByCause[cause] - prevDeaths[cause]
      prevDeaths[cause] = sim.deathsByCause[cause]
      causes += ' ' + cause + '=' + delta
    }

    console.log('tick ' + tick + ' band=' + bandCount + ' meanDev=' + (bandCount ? devSum / bandCount : 0).toFixed(1) + ' regCost/interval=' + costSum.toFixed(1) + ' deaths:' + causes)
  }
}

for (const seed of SEEDS) runSeed(seed)
