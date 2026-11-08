/**
 * Scratch diagnostic (not part of the test suite): where does the strict
 * carnivore band go under the committed default? Two different failures look
 * identical in a population count — animals dying, and animals whose inherited
 * diet drifts back below 0.66 and out of the band. This probe separates them:
 * it wraps `kill()` so every exit is attributed to the cause the engine
 * actually used, and it censuses animals by inherited diet class per window.
 *
 *   npx vite-node tests/scratch-carnivore-band.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import type { DeathCause } from '../src/sim/types'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

const TICKS = 3000
const CHUNK = 250
/** The acceptance gate in PROGRESS.md §6D is inherited diet above this. */
const STRICT = 0.66

interface Tally {
  strict: number
  moderate: number
}

function dietClass(c: Creature): 'strict' | 'moderate' | null {
  const diet = c.genome[TRAIT_INDEX.diet]
  if (diet > STRICT) return 'strict'
  if (diet > 0.4) return 'moderate'
  return null
}

function run(seed: string): void {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  // Every death the engine records, split by the diet class of the animal that died.
  const exits = new Map<string, number>()
  type Kill = (c: Creature, cause: DeathCause) => void
  const engine = sim as unknown as { kill: Kill }
  const inner = engine.kill.bind(sim)
  engine.kill = (c: Creature, cause: DeathCause) => {
    const cls = dietClass(c)
    if (cls) {
      const cohort = c.birthTick === 0 ? 0 : Math.floor((c.birthTick - 1) / CHUNK) + 1
      const key = `${cls} cohort ${cohort} ${cause}`
      exits.set(key, (exits.get(key) ?? 0) + 1)
    }
    inner(c, cause)
  }

  const census = (): Tally => {
    const out: Tally = { strict: 0, moderate: 0 }
    for (const c of sim.creatures) {
      if (!c.alive) continue
      const diet = c.genome[TRAIT_INDEX.diet]
      if (diet > STRICT) out.strict += 1
      else if (diet > 0.4) out.moderate += 1
    }
    return out
  }

  const lines: string[] = []
  const first = census()
  lines.push(
    `  t   0: strict=${first.strict} moderate=${first.moderate} ` +
      `herbivores=${sim.creatures.length - first.strict - first.moderate}`,
  )
  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    let maturePrey = 0
    for (const c of sim.creatures) {
      if (c.alive && c.genome[TRAIT_INDEX.diet] <= 0.75 && c.age >= c.phenotype.maturityAge) maturePrey += 1
    }
    const t = census()
    lines.push(
      `  t${String(window * CHUNK).padStart(4)}: strict=${String(t.strict).padStart(4)} ` +
        `moderate=${String(t.moderate).padStart(4)} maturePrey=${String(maturePrey).padStart(4)}`,
    )
  }

  console.log(`\n--- seed ${seed} ---`)
  for (const line of lines) console.log(line)
  console.log('  exits, by inherited diet class and the cause the engine used (cohort 0 = founding load):')
  for (const key of [...exits.keys()].sort()) console.log(`    ${key}: ${exits.get(key)}`)
}

console.log(`strict band = inherited diet > ${STRICT}; moderate = 0.4..${STRICT}`)
for (const seed of ['evolab', 'evolab-2', 'evolab-3']) run(seed)
