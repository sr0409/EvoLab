/**
 * Genealogy: for every creature that has ever existed we keep both parents.
 *
 * Records are appended in creature-id order, so everything is a dense typed
 * array — cheap to store, cheap to save, and enough to walk any living
 * creature's family tree backwards. The store is capped so a very long run
 * cannot grow without bound; when it trims, the oldest lineages are dropped.
 */
export class LineageStore {
  parentA: Int32Array
  parentB: Int32Array
  birthTick: Int32Array
  /** -1 for founders (origin unknown), 0 for a virgin birth, otherwise the other parent's id. */
  mateId: Int32Array
  count = 0
  trimmedBefore = 0

  constructor(capacity = 4096, readonly maxRecords = 120000) {
    this.parentA = new Int32Array(capacity).fill(-1)
    this.parentB = new Int32Array(capacity).fill(-1)
    this.birthTick = new Int32Array(capacity)
    this.mateId = new Int32Array(capacity).fill(-1)
  }

  /** Register a creature. Ids must be supplied in increasing order. */
  add(id: number, parent1: number, parent2: number, birthTickValue: number, mate: number): void {
    if (id < this.trimmedBefore) return
    if (id >= this.parentA.length) this.grow(id + 1)
    this.parentA[id] = parent1
    this.parentB[id] = parent2
    this.birthTick[id] = birthTickValue
    this.mateId[id] = mate
    if (id + 1 > this.count) this.count = id + 1
    this.trimIfNeeded()
  }

  has(id: number): boolean {
    return id >= this.trimmedBefore && id < this.count
  }

  parentsOf(id: number): [number, number] {
    if (!this.has(id)) return [-1, -1]
    return [this.parentA[id], this.parentB[id]]
  }

  /** Walk up the tree collecting ancestors up to `depth` generations. */
  ancestry(id: number, depth = 4): number[] {
    const out: number[] = []
    let frontier: number[] = [id]
    for (let generation = 0; generation < depth; generation++) {
      const next: number[] = []
      for (const current of frontier) {
        const [a, b] = this.parentsOf(current)
        if (a >= 0) {
          out.push(a)
          next.push(a)
        }
        if (b >= 0 && b !== a) {
          out.push(b)
          next.push(b)
        }
      }
      if (!next.length) break
      frontier = next
    }
    return out
  }

  private trimIfNeeded(): void {
    if (this.count - this.trimmedBefore <= this.maxRecords) return
    // Drop whole generations from the front so ids stay monotonic.
    const excess = this.count - this.trimmedBefore - this.maxRecords
    this.trimmedBefore += Math.min(excess, this.count - this.trimmedBefore)
  }

  private grow(size: number): void {
    let capacity = this.parentA.length * 2 || 4096
    while (capacity < size) capacity *= 2
    this.parentA = resizeInt32(this.parentA, capacity, -1)
    this.parentB = resizeInt32(this.parentB, capacity, -1)
    this.birthTick = resizeInt32(this.birthTick, capacity, 0)
    this.mateId = resizeInt32(this.mateId, capacity, -1)
  }

  snapshot(): {
    parentA: number[]
    parentB: number[]
    birthTick: number[]
    mateId: number[]
    trimmedBefore: number
  } {
    const from = this.trimmedBefore
    const to = this.count
    return {
      parentA: Array.from(this.parentA.subarray(from, to)),
      parentB: Array.from(this.parentB.subarray(from, to)),
      birthTick: Array.from(this.birthTick.subarray(from, to)),
      mateId: Array.from(this.mateId.subarray(from, to)),
      trimmedBefore: from
    }
  }

  restore(data: {
    parentA: number[] | Int32Array
    parentB: number[] | Int32Array
    birthTick: number[] | Int32Array
    mateId: number[] | Int32Array
    trimmedBefore: number
  }): void {
    const trimmed = data.trimmedBefore ?? 0
    const size = data.parentA.length + trimmed
    this.trimmedBefore = trimmed
    this.grow(Math.max(size, 16))
    this.parentA.fill(-1)
    this.parentB.fill(-1)
    this.mateId.fill(-1)
    this.birthTick.fill(0)
    for (let i = 0; i < data.parentA.length; i++) {
      const id = trimmed + i
      this.parentA[id] = data.parentA[i]
      this.parentB[id] = data.parentB[i]
      this.birthTick[id] = data.birthTick[i]
      this.mateId[id] = data.mateId[i]
    }
    this.count = size
  }
}

function resizeInt32(source: Int32Array, size: number, fill: number): Int32Array {
  const next = new Int32Array(size).fill(fill)
  next.set(source)
  return next
}