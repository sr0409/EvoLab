import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'

// Measurement probe (milestone 6, documentation only): worst-case tick cost
// on the real default 168x112 world as its population grows toward the cap.
// Run with: npx vite-node tests/scratch-perf-probe.ts
const sim = new Simulation(defaultConfig())
for (let batch = 0; batch < 12; batch++) {
  const start = performance.now()
  sim.run(200)
  const ms = (performance.now() - start) / 200
  console.log(
    `tick ${sim.tick}: population ${sim.creatures.length}, ms/tick ${ms.toFixed(2)}`
  )
}
