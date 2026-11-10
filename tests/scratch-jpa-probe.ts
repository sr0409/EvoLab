import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'

/** Scratch diagnostic: the exact trajectories the "moving the knob off 1" test
 * asserts on. Both arms of the default world run in lockstep with 100-tick
 * censuses, reporting the band census, the peaks, and the first census where
 * the two worlds' fingerprints differ. Run with:
 *
 *   npx vite-node tests/scratch-jpa-probe.ts
 */
function fingerprint(sim: Simulation): string {
  const alive = sim.creatures.filter((c) => c.alive).length
  return JSON.stringify({
    alive,
    species: sim.species.snapshot().records
  })
}

function census(sim: Simulation): { band: number; juveniles: number } {
  let band = 0
  let juveniles = 0
  for (const c of sim.creatures) {
    if (!c.alive) continue
    if (c.phenotype.diet <= 0.66) continue
    band++
    if (c.age < c.phenotype.maturityAge) juveniles++
  }
  return { band, juveniles }
}

interface Arm {
  peakBand: number
  peakJuveniles: number
  prints: string[]
}

for (const seed of ['evolab-3']) {
  const arms: Record<'off' | 'on', Arm> = {
    off: { peakBand: 0, peakJuveniles: 0, prints: [] },
    on: { peakBand: 0, peakJuveniles: 0, prints: [] }
  }
  for (const key of ['off', 'on'] as const) {
    const config = defaultConfig()
    config.world.seed = seed
    config.predation.juvenilePlantAllowance = key === 'on' ? 1 : 0
    const sim = new Simulation(config)
    const arm = arms[key]
    const started = Date.now()
    while (sim.tick < 1000) {
      sim.run(100)
      const c = census(sim)
      if (c.band > arm.peakBand) arm.peakBand = c.band
      if (c.juveniles > arm.peakJuveniles) arm.peakJuveniles = c.juveniles
      arm.prints.push(fingerprint(sim))
      console.log(`${key} t=${sim.tick} band=${c.band} juveniles=${c.juveniles}`)
    }
    console.log(`${key} run took ${Date.now() - started}ms`)
  }

  const off = arms.off
  const on = arms.on
  let firstDivergence = -1
  for (let i = 0; i < Math.min(off.prints.length, on.prints.length); i++) {
    if (off.prints[i] !== on.prints[i]) {
      firstDivergence = (i + 1) * 100
      break
    }
  }
  console.log(
    `off peakBand=${off.peakBand} peakJuveniles=${off.peakJuveniles} | ` +
      `on peakBand=${on.peakBand} peakJuveniles=${on.peakJuveniles} | firstDivergence=${firstDivergence}`
  )
}
