/**
 * Scratch diagnostic (not a test): what energy flow does the strict carnivore
 * band actually have in the fixed founder world?
 *
 * Simulation.kill and Simulation.attack are wrapped on the instance, so every
 * hunt attempt, every kill and every strict-band death is recorded with the
 * exact numbers the engine was holding at that moment: what the hunter held
 * before and after the bite, what the quarry held, and the cause the engine
 * attributed to each death. That separates the possible failure modes —
 * kills that pay too little, maintenance that outcrops income, or a band that
 * starves its young before they ever recruit.
 *
 * Run with: npx vite-node tests/scratch-carnivore-energy-audit.ts
 */
import { Simulation } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { TRAIT_INDEX } from '../src/sim/traits'

const WINDOW = 100
const LAST_TICK = 3000
const STRICT = 0.8

interface Organism {
  id: number
  alive: boolean
  energy: number
  maxEnergy: number
  age: number
  genome: ArrayLike<number>
}

interface EngineInternals {
  kill(c: Organism, cause: string): void
  attack(c: Organism, prey: Organism): void
}

function isStrict(c: Organism): boolean {
  return c.genome[TRAIT_INDEX.diet] >= STRICT
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, v) => a + v, 0) / values.length
}

function run(seed: string): void {
  const config = defaultConfig()
  config.world.seed = seed
  const sim = new Simulation(config)

  const engine = sim as unknown as EngineInternals
  const realKill = engine.kill.bind(sim) as EngineInternals['kill']
  const realAttack = engine.attack.bind(sim)

  let attacks = 0
  let captures = 0
  let gained = 0
  let preyEnergy = 0
  let deaths: { cause: string; held: number; ceiling: number; age: number }[] = []

  engine.kill = (c: Organism, cause: string): void => {
    if (isStrict(c)) {
      deaths.push({ cause, held: c.energy, ceiling: c.maxEnergy, age: c.age })
    }
    realKill(c, cause)
  }

  engine.attack = (c: Organism, prey: Organism): void => {
    if (isStrict(c)) {
      const before = c.energy
      const preyBefore = prey.energy
      realAttack(c, prey)
      attacks += 1
      if (c.energy > before) {
        captures += 1
        gained += c.energy - before
        preyEnergy += preyBefore
      }
    } else {
      realAttack(c, prey)
    }
  }

  console.log(`=== ${seed} ===`)
  while (sim.tick < LAST_TICK) {
    sim.tickStep()
    if (sim.tick % WINDOW !== 0) continue

    const live = sim.creatures as unknown as Organism[]
    const band = live.filter(isStrict)
    const held = live
      .filter((c) => isStrict(c) && c.alive)
      .map((c) => c.energy)

    console.log(
      `t${String(sim.tick).padStart(4)}: strict=${held.length} ` +
        `held=${mean(held).toFixed(1)} ceiling=${mean(live.filter((c) => isStrict(c)).map((c) => c.maxEnergy)).toFixed(1)} ` +
        `age=${mean(live.filter((c) => isStrict(c)).map((c) => c.age)).toFixed(0)} ` +
        `herb total=${sim.creatures.length - held.length}`
    )
    console.log(
      `  window: attacks=${attacks} kills=${captures} ` +
        `gain/kill=${captures ? (gained / captures).toFixed(1) : 0} ` +
        `prey held=${captures ? (preyEnergy / captures).toFixed(1) : 0}`
    )
    const byCause = new Map<string, number>()
    for (const d of deaths) byCause.set(d.cause, (byCause.get(d.cause) ?? 0) + 1)
    const breakdown = [...byCause.entries()].sort((a, b) => b[1] - a[1])
    for (const [cause, count] of breakdown) {
      const group = deaths.filter((d) => d.cause === cause)
      console.log(
        `  strict died '${cause}': ${count} held=${group.map((d) => d.held.toFixed(1)).join(',')} ` +
          `age=${Math.max(...group.map((d) => d.age))}`
      )
    }
    attacks = 0
    captures = 0
    gained = 0
    preyEnergy = 0
    deaths = []
  }
}

for (const seed of ['evolab', 'evolab-2', 'evolab-3']) {
  run(seed)
  console.log('')
}
