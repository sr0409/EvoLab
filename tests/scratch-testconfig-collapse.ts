import { Simulation } from '../src/sim/engine'
import { testConfig } from './helpers'

// One-off diagnostic (2026-11): does the 48x48 test configuration collapse on
// seed 'evolab'? The suite only runs 1500 ticks on 'probe-*' seeds and passes;
// this checks whether a longer run on the fixture seed heads for extinction,
// the way the default world does on some seeds. Prints alive counts per 250
// ticks and the death ledger at the end.
//
//   npx tsx tests/scratch-testconfig-collapse.ts
const sim = new Simulation(testConfig('evolab'))
for (let tick = 250; tick <= 1500; tick += 250) {
  sim.run(250)
  let alive = 0
  for (const c of sim.creatures) {
    if (c.alive) alive += 1
  }
  console.log(`tick=${sim.tick} alive=${alive} deaths=${JSON.stringify(sim.deathsByCause)}`)
}
