/**
 * Throwaway diagnostic: where does the population actually settle?
 * Runs the default configuration and reports the trajectory — total animals,
 * per-diet bands, deaths by cause and vegetation level — against the
 * config's maxCreatures ceiling. Run with:  npx vite-node tests/scratch-population.ts
 */
import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { dietClassOf } from '../src/sim/types'
import { TRAIT_INDEX } from '../src/sim/traits'

const DIET = TRAIT_INDEX.diet

const TICKS = 6000
const EVERY = 250

const capOverride = Number(process.argv[2] ?? 0)
const sim = new Simulation(defaultConfig())
if (capOverride > 0) sim.config.population.maxCreatures = capOverride
const ceiling = sim.config.population.maxCreatures
console.log(
  `world ${sim.world.width}x${sim.world.height}  ceiling(maxCreatures) ${ceiling}  ` +
    `founders ${sim.creatures.length}`
)

let prevDeaths = { ...sim.deathsByCause }
for (let tick = EVERY; tick <= TICKS; tick += EVERY) {
  sim.run(EVERY)

  const alive = sim.creatures.filter((c) => c.alive)
  const bands = { herbivore: 0, omnivore: 0, carnivore: 0 }
  let dietSum = 0
  for (const c of alive) {
    const diet = c.genome[DIET]
    dietSum += diet
    bands[dietClassOf(diet)] += 1
  }
  const speciesCount = sim.species.species.filter(
    (s) => s.extinctionTick < 0 && s.memberCount > 0
  ).length

  const deaths = Object.entries(sim.deathsByCause)
    .map(([cause, n]) => {
      const d = n - (prevDeaths[cause as keyof typeof prevDeaths] ?? 0)
      return `${cause} ${d}`
    })
    .join('  ')
  prevDeaths = { ...sim.deathsByCause }

  let land = 0
  for (let i = 0; i < sim.world.terrain.length; i++) if (sim.world.terrain[i] !== 0) land += 1
  const vegetation = sim.world.totalBiomass() / land

  console.log(
    `tick ${String(tick).padStart(5)}  population ${String(alive.length).padStart(5)}` +
    `/ceiling ${ceiling}  species ${speciesCount}  mean diet ${(dietSum / Math.max(1, alive.length)).toFixed(2)}` +
      `  herbivore ${bands.herbivore}  omnivore ${bands.omnivore}` +
      `  carnivore ${bands.carnivore}  mean vegetation ${vegetation.toFixed(2)}  deaths since last: ${deaths}`
  )
}
