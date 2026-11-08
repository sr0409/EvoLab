/**
 * Scratch diagnostic — §8 candidate (l): pack hunting. **Rejected and reverted.**
 * Recorded result (three seeds, 3000 ticks): the pack rule fires — max widening
 * factor 1.52 / 1.69 / 1.66 — but it opens nothing the engine was not already
 * eating: quarry picks above the solo window 0 / 0 / 1, kills on prey above the
 * solo window 0 / 0 / 0, and the band at the 3000-tick census comes out
 * 0 / 0 / 7, against 0 / 0 / 11 with the rule off. §6D carries the numbers.
 *
 * The candidate rule: a strict carnivore (diet > 0.66) that has mature
 * conspecifics of its own species within its own senses widens its prey-mass
 * window in `preyIsLegal` by `1 + 0.35 × sociality × packmates`, packmates
 * capped at 3. `sociality` is the engine's existing heritable social trait.
 *
 * Like `tests/scratch-carnivore-quota.ts`, this probe measures the candidate
 * against the committed engine, not against a modified one: the engine as it is
 * stands for the solo arm, and the pack arm installs the candidate rule on the
 * instance by patching `preyIsLegal`. Same config, same seed, one rule
 * different. It also counts what the mechanism actually opened — the strongest
 * widening factor computed, quarry picks and kills on prey above the solo
 * window — which is what showed the size gate is empty in these worlds.
 *
 *   npx vite-node tests/scratch-pack-hunt.ts
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

const TICKS = 3000
const CHUNK = 250

/** The engine's solo mass window: what `preyIsLegal` allows with no pack. */
const soloWindow = (c: Creature) => c.phenotype.mass * (0.35 + 1.7 * c.phenotype.diet)

interface EngineInternals {
  preyIsLegal: (c: Creature, o: Creature) => boolean
  pickQuarry: (c: Creature) => Creature | undefined
  attack: (c: Creature, o: Creature) => void
  neighborsWithin: (
    c: Creature,
    radiusTiles: number,
    predicate: (o: Creature) => boolean,
    limit: number,
  ) => Creature[]
}

interface CensusLine {
  tick: number
  population: number
  strict: number
  bandSociality: number
}

interface Arm {
  seed: string
  pack: boolean
  lines: CensusLine[]
  maxFactor: number
  packOnlyPicks: number
  packOnlyKills: number
  totalKills: number
}

/** The candidate rule, verbatim as it stood in `engine.ts` before the revert. */
function packHuntBonus(internals: EngineInternals, c: Creature): number {
  const ph = c.phenotype
  if (ph.diet <= 0.66 || ph.sociality <= 0.05) return 1
  const packmates = internals.neighborsWithin(
    c,
    ph.senseRadius,
    (o) =>
      o.id !== c.id &&
      o.speciesId === c.speciesId &&
      o.alive &&
      o.age >= o.phenotype.maturityAge &&
      o.phenotype.diet > 0.66,
    3,
  ).length
  if (packmates === 0) return 1
  return 1 + 0.35 * ph.sociality * packmates
}

function run(seed: string, pack: boolean): Arm {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)
  const internals = sim as unknown as EngineInternals

  let maxFactor = 1
  let packOnlyPicks = 0
  let packOnlyKills = 0
  let totalKills = 0

  if (pack) {
    // Candidate arm: the widened mass gate lives on the instance.
    const original = internals.preyIsLegal.bind(sim)
    internals.preyIsLegal = (c: Creature, o: Creature) => {
      const factor = packHuntBonus(internals, c)
      if (factor > maxFactor) maxFactor = factor
      if (factor === 1) return original(c, o)
      return (
        o.alive &&
        o.id !== c.id &&
        o.speciesId !== c.speciesId &&
        o.age >= o.phenotype.maturityAge &&
        o.phenotype.mass < soloWindow(c) * factor &&
        o.energy > 0.2
      )
    }
  }

  // Observe what the rule actually chose: quarry picks on prey the solo gate
  // would have refused. In the solo arm this is the engine's own overshoot
  // check and must stay 0; in the pack arm it is what the pack unlocked.
  const originalPick = internals.pickQuarry.bind(sim)
  internals.pickQuarry = (c: Creature) => {
    const quarry = originalPick(c)
    if (quarry && quarry.phenotype.mass >= soloWindow(c)) packOnlyPicks++
    return quarry
  }

  // Observe what it actually killed: a kill whose prey was above the hunter's
  // own solo window is a kill only a pack could have made legal.
  const originalAttack = internals.attack.bind(sim)
  internals.attack = (c: Creature, o: Creature) => {
    const wasAlive = o.alive
    const aboveSoloWindow = o.phenotype.mass >= soloWindow(c)
    originalAttack(c, o)
    if (wasAlive && !o.alive) {
      totalKills++
      if (aboveSoloWindow) packOnlyKills++
    }
  }

  const lines: CensusLine[] = []
  for (let window = 1; window * CHUNK <= TICKS; window++) {
    sim.run(CHUNK)
    let population = 0
    let strict = 0
    let socialitySum = 0
    for (const c of sim.creatures) {
      if (!c.alive) continue
      population++
      if (c.genome[TRAIT_INDEX.diet] > 0.66) {
        strict++
        socialitySum += c.genome[TRAIT_INDEX.sociality]
      }
    }
    lines.push({
      tick: window * CHUNK,
      population,
      strict,
      bandSociality: strict > 0 ? socialitySum / strict : 0,
    })
  }

  const label = pack ? 'pack' : 'solo '
  console.log(`\n--- seed ${seed} — ${label} ---`)
  for (const line of lines) {
    console.log(
      `  t${String(line.tick).padStart(4)}: population=${String(line.population).padStart(4)} ` +
        `strict=${String(line.strict).padStart(3)} bandSociality=${line.bandSociality.toFixed(2)}`,
    )
  }
  console.log(`  predation kills: ${sim.deathsByCause.predation} (attacks observed: ${totalKills})`)
  console.log(
    `  mechanism engagement: max factor ${maxFactor.toFixed(2)}, picks above the solo ` +
      `window: ${packOnlyPicks}, kills above the solo window: ${packOnlyKills}`,
  )
  return { seed, pack, lines, maxFactor, packOnlyPicks, packOnlyKills, totalKills }
}

const arms: Arm[] = []
for (const seed of ['evolab', 'evolab-2', 'evolab-3']) {
  arms.push(run(seed, false))
  arms.push(run(seed, true))
}

console.log('\n=== candidate (l) pack hunting — band at the 3000-tick census ===')
for (const seed of ['evolab', 'evolab-2', 'evolab-3']) {
  const solo = arms.find((a) => a.seed === seed && !a.pack)!
  const pack = arms.find((a) => a.seed === seed && a.pack)!
  const end = solo.lines.length - 1
  console.log(
    `  ${seed.padEnd(10)} solo: strict=${String(solo.lines[end].strict).padStart(3)} ` +
      `pop=${String(solo.lines[end].population).padStart(4)}  |  ` +
      `pack: strict=${String(pack.lines[end].strict).padStart(3)} ` +
      `pop=${String(pack.lines[end].population).padStart(4)}  ` +
      `pack-only kills=${pack.packOnlyKills} maxFactor=${pack.maxFactor.toFixed(2)} ` +
      `packOnlyPicks=${pack.packOnlyPicks}`,
  )
}
