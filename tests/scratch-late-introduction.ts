import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { founderGenome, TRAIT_INDEX } from '../src/sim/traits'
import { Rng } from '../src/sim/rng'
import { DEATH_CAUSES, type DeathCause } from '../src/sim/types'

// Diagnostic scratch probe (not part of the test suite): late introduction.
// The founder-ratio studies ask whether carnivores survive the bootstrapping
// window against a founding herd. This probe asks the other half: can a
// carnivore band persist in an already-established producer world? Carnivores
// are introduced at tick 1500, after the producer community has grown to its
// equilibrium, so the prey supply is adult-rich and continuous. If the band
// lives here but never at founding, the cold-start is the whole problem; if it
// dies here too, strict carnivory is unsupported at equilibrium as well.
//
//   npx tsx tests/scratch-late-introduction.ts
const SEEDS = ['evolab', 'evolab-2', 'evolab-3']
const CHUNK = 250
const ESTABLISH = 1500
const TICKS = 3000
const INJECT = 12

for (const seed of SEEDS) {
  const config = defaultConfig()
  config.world.seed = seed
  config.population.founders = { herbivore: 60, omnivore: 18, carnivore: 0 }
  const sim = new Simulation(config)
  sim.run(ESTABLISH)

  const speciesId = sim.species.species.findIndex((s) => s.diet === 'carnivore')
  const rng = new Rng(`${seed}#introduction`)
  const width = config.world.width
  for (let i = 0; i < INJECT; i++) {
    const hosts = sim.creatures.filter(
      (c) => c.alive && c.age >= c.phenotype.maturityAge && c.phenotype.diet < 0.34 && c.energy > 2
    )
    if (hosts.length === 0) {
      console.log(`${seed}: no adult hosts at tick ${ESTABLISH}, cannot introduce`)
      break
    }
    const host = hosts[rng.int(hosts.length)]
    const genome = founderGenome(rng, 'carnivore', 0)
    genome[TRAIT_INDEX.hue] = 10
    const tile = Math.floor(host.y) * width + Math.floor(host.x)
    // Engine-private on purpose: the probe injects through the engine's own
    // founder machinery (same physiology, same booking) rather than inventing one.
    ;(sim as unknown as { spawnFounder: (g: typeof genome, s: number, t: number) => void }).spawnFounder(
      genome,
      speciesId,
      tile
    )
  }

  const band: number[] = []
  const population: number[] = []
  const prevDeaths = Object.fromEntries(DEATH_CAUSES.map((cause) => [cause, 0])) as Record<
    DeathCause,
    number
  >
  for (let tick = CHUNK; tick <= TICKS; tick += CHUNK) {
    sim.run(CHUNK)
    let bandCount = 0
    for (const c of sim.creatures) if (c.alive && c.phenotype.diet > 0.66) bandCount += 1
    band.push(bandCount)
    population.push(sim.creatures.length)
    let causes = ''
    for (const cause of DEATH_CAUSES) {
      const current = sim.deathsByCause[cause]
      const delta = current - prevDeaths[cause]
      prevDeaths[cause] = current
      if (delta > 0) causes += ` ${cause}=${delta}`
    }
    console.log(`${seed} tick ${tick} band=${bandCount} population=${sim.creatures.length} deaths:${causes}`)
  }
}
