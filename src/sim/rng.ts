/**
 * Deterministic, serializable pseudo-random number generator.
 *
 * Every stochastic decision in EvoLab flows through an `Rng` instance. Nothing in
 * the simulation core may use `Math.random()` or timing APIs, otherwise runs could
 * not be reproduced from a seed, saved, restored, or diffed in tests.
 *
 * The generator is sfc32 (small, fast, good statistical quality) seeded through a
 * splitmix32 avalanche so that sequential seeds such as 1 and 2 produce completely
 * unrelated streams.
 */

export type RngState = readonly [number, number, number, number]

const UINT32 = 4294967296

/** Mix a string or number seed into a well-distributed 32-bit integer. */
export function hashSeed(seed: string | number): number {
  let h = 0x9e3779b9 >>> 0
  if (typeof seed === 'number') {
    h ^= Math.trunc(seed) >>> 0
    h ^= 0x1234567
  } else {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + i * 31
      h = Math.imul(h, 0x85ebca6b) >>> 0
      h ^= h >>> 13
      h = Math.imul(h, 0xc2b2ae35) >>> 0
      h ^= h >>> 16
    }
  }
  return h >>> 0
}

function splitmix32(state: number): { value: number; next: number } {
  const next = (state + 0x9e3779b9) >>> 0
  let z = next >>> 0
  z = Math.imul(z ^ (z >>> 16), 0x21f0aaad) >>> 0
  z = Math.imul(z ^ (z >>> 15), 0x735a2d97) >>> 0
  z = (z ^ (z >>> 15)) >>> 0
  return { value: z >>> 0, next }
}

export class Rng {
  private a = 0
  private b = 0
  private c = 0
  private d = 0
  private seedValue = 0

  constructor(seed: string | number = 1) {
    this.seed(seed)
  }

  /** (Re)initialise the stream from a seed. */
  seed(seed: string | number): void {
    this.seedValue = hashSeed(seed)
    let s = this.seedValue >>> 0
    const out: number[] = []
    for (let i = 0; i < 4; i++) {
      const r = splitmix32(s)
      out.push(r.value)
      s = r.next
    }
    this.a = out[0] >>> 0
    this.b = out[1] >>> 0
    this.c = out[2] >>> 0
    this.d = out[3] >>> 0
    // Warm up: discard the first outputs of the stream.
    for (let i = 0; i < 12; i++) this.nextUint32()
  }

  get seedId(): number {
    return this.seedValue
  }

  /** Next raw 32-bit unsigned value. */
  nextUint32(): number {
    const a = this.a
    const b = this.b
    const c = this.c
    const d = this.d
    const t = (a + b) | 0
    this.a = (b ^ (b >>> 9)) >>> 0
    this.b = (c + (c << 3)) | 0
    this.c = (((c << 23) | (c >>> 9)) + (d + 1)) | 0
    this.d = (t + 1) | 0
    void a
    return t >>> 0
  }

  /** Uniform float in [0, 1). */
  random(): number {
    return this.nextUint32() / UINT32
  }

  /** Uniform float in [min, max). */
  range(min: number, max: number): number {
    return min + (max - min) * this.random()
  }

  /** Uniform float in [-m, m). */
  symmetric(m: number): number {
    return (this.random() * 2 - 1) * m
  }

  /** Integer in [0, maxExclusive). */
  int(maxExclusive: number): number {
    if (maxExclusive <= 0) return 0
    return Math.min(maxExclusive - 1, Math.floor(this.random() * maxExclusive))
  }

  /** Integer in [min, max] inclusive. */
  intRange(min: number, max: number): number {
    if (max <= min) return min
    return min + this.int(max - min + 1)
  }

  /** True with probability p. */
  bool(p: number): boolean {
    return this.random() < p
  }

  /** Pick an index from [0, length). */
  index(length: number): number {
    return this.int(length)
  }

  pick<T>(items: readonly T[]): T {
    return items[this.int(items.length)]
  }

  /**
   * Normally distributed value (Box-Muller, no cached spare so that the stream
   * consumes a fixed, serializable number of draws per call).
   */
  gaussian(mean = 0, stdDev = 1): number {
    let u1 = this.random()
    if (u1 < 1e-12) u1 = 1e-12
    const u2 = this.random()
    const r = Math.sqrt(-2 * Math.log(u1))
    const theta = 6.283185307179586 * u2
    return mean + stdDev * r * Math.cos(theta)
  }

  /**
   * Draw an index with probability proportional to `weights[i]`.
   * Weights need not be normalised; non-positive weights are never chosen.
   */
  weighted(weights: ArrayLike<number>): number {
    let total = 0
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]
      if (w > 0) total += w
    }
    if (total <= 0) return -1
    let pickValue = this.random() * total
    for (let i = 0; i < weights.length; i++) {
      const w = weights[i]
      if (w <= 0) continue
      pickValue -= w
      if (pickValue <= 0) return i
    }
    return weights.length - 1
  }

  /** Snapshot the internal stream position (for save/load). */
  getState(): RngState {
    return [this.a, this.b, this.c, this.d]
  }

  loadState(state: RngState): void {
    this.a = state[0] >>> 0
    this.b = state[1] >>> 0
    this.c = state[2] >>> 0
    this.d = state[3] >>> 0
  }

  /** Copy of the generator at its current position. */
  clone(): Rng {
    const copy = new Rng(0)
    copy.seedValue = this.seedValue
    copy.a = this.a
    copy.b = this.b
    copy.c = this.c
    copy.d = this.d
    return copy
  }
}
