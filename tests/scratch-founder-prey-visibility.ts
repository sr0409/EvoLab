import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

// Diagnostic scratch probe (not part of the test suite): does the clustered
// founder spawning in the committed engine (founderRing / world.findSpawnNear,
// engine.ts ~line 258) put legal prey in front of the founder carnivores?
//
// The engine's own prey gates are used: different species, mass < hunter.mass
// * (0.35 + 1.7 * hunter.diet), energy > 0.2. "Visible" means inside the
// founder's own sense radius. The nearest legal quarry is also reported when
// it is out of sight (-1 = no legal quarry in the world at all).
//
//   npx tsx tests/scratch-founder-prey-visibility.ts
const SEEDS = ['evolab', 'evolab-2', 'evolab-3']

function isLegalPrey(hunter: any, other: any): boolean {
  return (
    other.speciesId !== hunter.speciesId &&
    other.phenotype.mass < hunter.phenotype.mass * (0.35 + 1.7 * hunter.phenotype.diet) &&
    other.energy > 0.2
  )
}

for (const seed of SEEDS) {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  const founders = sim.creatures.filter((c) => c.alive && c.genome[TRAIT_INDEX.diet] > 0.66)
  const visibleCounts: number[] = []
  const nearestTiles: number[] = []
  for (const founder of founders) {
    let visible = 0
    let nearest = Infinity
    for (const other of sim.creatures) {
      if (!other.alive || other.id === founder.id) continue
      const d = Math.hypot(other.x - founder.x, other.y - founder.y)
      if (isLegalPrey(founder, other)) {
        if (d < nearest) nearest = d
        if (d <= founder.phenotype.senseRadius) visible += 1
      }
    }
    visibleCounts.push(visible)
    nearestTiles.push(nearest)
  }
  console.log(
    `seed=${seed} founders=${founders.length} ` +
      `visibleLegalPrey=[${visibleCounts.join(',')}] ` +
      `nearestLegalPreyTiles=[${nearestTiles.map((d) => (d === Infinity ? -1 : Math.round(d))).join(',')}]`
  )
}
