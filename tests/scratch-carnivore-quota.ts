/**
 * Scratch diagnostic (not part of the test suite): the recruitment-quota rule in
 * `preyIsLegal` lets predators take an animal below its own `maturityAge` only
 * while that animal's population is growing (PROGRESS.md §8 step 3l). A rule
 * like that has to be measured against the rule it replaces, on the same seed
 * and the same world, or a change in the band is indistinguishable from noise.
 *
 * So each seed is run twice: once with the engine as it is, and once with the
 * young-legal exception switched off at runtime (the instance's own `preyIsLegal`
 * patched to the rule the engine had before). Same config, same seed, one rule
 * different.
 *
 *   npx vite-node tests/scratch-carnivore-quota.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import type { DeathCause } from '../src/sim/types'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

const TICKS = 3000
const CHUNK = 250
const STRICT = 0.66

interface Counts {
  strict: number
  moderate: number
  population: number
}

interface Predation {
  young: number
  adult: number
}

function run(seed: string, quotaOff: boolean): Counts {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  // Patch the instance's own methods: `kill` tallies causes globally, so an
  // attributed young/adult predation count has to come from the call itself.
  const engine = sim as unknown as {
    kill: (c: Creature, cause: DeathCause) => void
    preyIsLegal: (c: Creature, o: Creature) => boolean
  }

  const predation: Predation = { young: 0, adult: 0 }
  const killInner = engine.kill.bind(sim)
  engine.kill = (c: Creature, cause: DeathCause) => {
    if (cause === 'predation') {
      if (c.age < c.phenotype.maturityAge) predation.young += 1
      else predation.adult += 1
    }
    killInner(c, cause)
  }

  if (quotaOff) {
    // The rule the engine had before: an animal below its own maturityAge is
    // never quarry, whoever is asking.
    const legalInner = engine.preyIsLegal.bind(sim)
    engine.preyIsLegal = (c: Creature, o: Creature) =>
      o.age >= o.phenotype.maturityAge && legalInner(c, o)
  }

  const census = (): Counts => {
    const out: Counts = { strict: 0, moderate: 0, population: 0 }
    for (const c of sim.creatures) {
      if (!c.alive) continue
      out.population += 1
      const diet = c.genome[TRAIT_INDEX.diet]
      if (diet > STRICT) out.strict += 1
      else if (diet > 0.4) out.moderate += 1
    }
    return out
  }

  const lines: string[] = []
  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    const c = census()
    lines.push(
      `  t${String(window * CHUNK).padStart(4)}: strict=${String(c.strict).padStart(4)} ` +
        `moderate=${String(c.moderate).padStart(4)} population=${String(c.population).padStart(5)}`,
    )
  }

  console.log(`\n--- seed ${seed} — recruitment quota ${quotaOff ? 'off' : 'on'} ---`)
  for (const line of lines) console.log(line)
  console.log(
    `  predation kills: young=${predation.young} adult=${predation.adult} ` +
      `total=${sim.deathTotals().predation}`,
  )
  return census()
}

const results: { seed: string; off: Counts; on: Counts }[] = []
for (const seed of ['evolab', 'evolab-2', 'evolab-3']) {
  const off = run(seed, true)
  const on = run(seed, false)
  results.push({ seed, off, on })
}

console.log('\n=== strict band (inherited diet > 0.66) at the 3000-tick census ===')
for (const r of results) {
  console.log(
    `  ${r.seed}: quota off strict=${r.off.strict} population=${r.off.population}` +
      `   |   quota strict=${r.on.strict} population=${r.on.population}`,
  )
}
