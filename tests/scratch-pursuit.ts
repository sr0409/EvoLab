/**
 * One-off diagnostic: instrument a single hunt episode at a time.
 *
 * For every strict-carnivore attack, record what happens to that hunter/prey
 * pair afterwards: how far the gap moves each tick, whether the prey is fleeing,
 * how many ticks pass until the next attack or the kill. This tells us why
 * hunts fail *after* first contact, which the aggregate probe cannot see.
 */
import { Simulation } from '../src/sim/engine'
import type { Creature } from '../src/sim/engine'
import { defaultConfig } from '../src/sim/config'
import { BEHAVIOR_NAMES } from '../src/sim/types'

const sim = new Simulation(defaultConfig())
type AnyRec = Record<string, unknown>
type PairState = {
  gapAtAttack: number
  ticksSinceAttack: number
  attacks: number
  gaps: number[] // gap at each subsequent tick until reset
  fleeTicks: number
}
type AnyFn = (...args: unknown[]) => unknown
const pairs = new Map<string, PairState>() // "hunterId:preyId" -> state while chase is live
const pairStats: AnyRec[] = [] // finished episodes
const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number =>
  Math.hypot(a.x - b.x, a.y - b.y)

const proto = Object.getPrototypeOf(sim) as Record<string, AnyFn>
const origAttack = proto['attack'] as NonNullable<AnyFn>

proto['attack'] = (function (c: Creature, prey: Creature): void {
  const key = `${c.id}:${prey.id}`
  const gap = dist(c, prey)
  let st = pairs.get(key)
  if (!st) {
    st = { gapAtAttack: gap, ticksSinceAttack: 0, attacks: 1, gaps: [gap], fleeTicks: 0 }
    pairs.set(key, st)
  } else {
    st.attacks += 1
    st.gaps.push(gap)
    st.ticksSinceAttack = 0
  }
  origAttack.call(sim, c, prey)
  if (prey.health <= 0 || !prey.alive) {
    // episode finished by a kill
    pairStats.push({
      key,
      attacks: st.attacks,
      cause: 'killed',
      ticks: st.ticksSinceAttack,
      gaps: st.gaps.slice(0, 12),
      fleeTicks: st.fleeTicks,
      preyHealth: prey.health,
      preySpeed: prey.phenotype.speed,
      preyBehavior: BEHAVIOR_NAMES[prey.behavior]
    })
    pairs.delete(key)
  }
}) as unknown as AnyFn

// Track gaps + prey behavior for live pairs each tick.
const origTick = proto['tickStep'] as AnyFn
proto['tickStep'] = function (): void {
  origTick.call(sim)
  for (const [key, st] of pairs) {
    const [, pid] = key.split(':').map(Number)
    const prey = sim.creatures.find((c) => c.id === pid)
    if (!prey || !prey.alive) continue
    st.ticksSinceAttack += 1
    // hunter id:
    const hid = Number(key.split(':')[0])
    const hunter = sim.creatures.find((c) => c.id === hid)
    if (!hunter) {
      pairStats.push({ key, attacks: st.attacks, cause: 'hunter gone', ticks: st.ticksSinceAttack, gaps: st.gaps.slice(0, 12) })
      pairs.delete(key)
      continue
    }
    const gap = dist(hunter, prey)
    if (st.ticksSinceAttack === 1) st.gaps.push(gap)
    if (prey.behavior === 3) st.fleeTicks += 1
    if (gap > 8 || st.ticksSinceAttack > 60) {
      pairStats.push({
        key,
        attacks: st.attacks,
        cause: 'escaped',
        ticks: st.ticksSinceAttack,
        gaps: st.gaps.slice(0, 12),
        fleeTicks: st.fleeTicks,
        preyHealth: prey.health,
        preySpeed: prey.phenotype.speed,
        preyBehavior: BEHAVIOR_NAMES[prey.behavior]
      })
      pairs.delete(key)
    }
  }
}

sim.run(600)
// flush live pairs
for (const [key, st] of pairs) {
  pairStats.push({ key, attacks: st.attacks, cause: 'still chasing at end', ticks: st.ticksSinceAttack, gaps: st.gaps.slice(0, 12) })
}
pairStats.sort((a: AnyRec, b: AnyRec) => (b['attacks'] as number) - (a['attacks'] as number))
console.log(`episodes: ${pairStats.length}`)
const byCause: Record<string, number> = {}
for (const s of pairStats) byCause[s['cause'] as string] = (byCause[s['cause'] as string] ?? 0) + 1
console.log('by cause:', JSON.stringify(byCause))
console.log('sample episodes (top 25 by attack count):')
for (const s of pairStats.slice(0, 25)) {
  console.log(
    JSON.stringify({
      key: s['key'],
      cause: s['cause'],
      attacks: s['attacks'],
      ticks: s['ticks'],
      gaps: (s['gaps'] as number[]).map((g) => Math.round(g * 100) / 100),
      fleeTicks: s['fleeTicks'],
      preyHealth: typeof s['preyHealth'] === 'number' ? Math.round(s['preyHealth'] * 100) / 100 : s['preyHealth'],
      preySpeed: s['preySpeed'],
      preyBehavior: s['preyBehavior']
    })
  )
}
