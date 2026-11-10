/**
 * Uniform-grid spatial index over live agents, rebuilt once per tick.
 *
 * The engine fills a scratch array with each agent's cell index and this class
 * turns it into CSR-style buckets (counts → prefix sums → item array) in two
 * linear passes. Neighbour queries then scan a square window of cells, which is
 * what keeps perception cost O(1) per agent instead of O(n).
 *
 * Buffers are reused between ticks; nothing is allocated per frame.
 */
export class SpatialGrid {
  readonly cols: number
  readonly rows: number
  readonly cellSize: number
  readonly cellCount: number

  private counts: Int32Array
  private starts: Int32Array
  private cursor: Int32Array
  private items: Int32Array
  private scratch: Int32Array

  constructor(width: number, height: number, cellSize = 6) {
    this.cellSize = Math.max(1, cellSize)
    this.cols = Math.max(1, Math.ceil(width / this.cellSize))
    this.rows = Math.max(1, Math.ceil(height / this.cellSize))
    this.cellCount = this.cols * this.rows
    this.counts = new Int32Array(this.cellCount)
    this.starts = new Int32Array(this.cellCount + 1)
    this.cursor = new Int32Array(this.cellCount)
    this.items = new Int32Array(1024)
    this.scratch = new Int32Array(1024)
  }

  /** Cell index for a world-space position (clamped to the grid). */
  cellIndex(x: number, y: number): number {
    let cx = (x / this.cellSize) | 0
    let cy = (y / this.cellSize) | 0
    if (cx < 0) cx = 0
    else if (cx >= this.cols) cx = this.cols - 1
    if (cy < 0) cy = 0
    else if (cy >= this.rows) cy = this.rows - 1
    return cy * this.cols + cx
  }

  /** True if `index` refers to a cell inside the grid. */
  inGrid(cx: number, cy: number): boolean {
    return cx >= 0 && cy >= 0 && cx < this.cols && cy < this.rows
  }

  cellOf(item: number): number {
    return this.scratch[item]
  }

  /** How many agents share one cell in the current index. */
  occupancy(cell: number): number {
    return cell >= 0 && cell < this.cellCount ? this.counts[cell] : 0
  }

  /** Rebuild the index from the agent cell assignment [0, count). */
  build(count: number): void {
    const scratch = this.ensureScratch(count)
    const counts = this.counts
    const starts = this.starts
    counts.fill(0)
    for (let i = 0; i < count; i++) counts[scratch[i]]++
    let running = 0
    for (let c = 0; c < this.cellCount; c++) {
      starts[c] = running
      running += counts[c]
      this.cursor[c] = starts[c]
    }
    starts[this.cellCount] = running
    const items = this.ensureItems(count)
    for (let i = 0; i < count; i++) {
      const cell = scratch[i]
      items[this.cursor[cell]++] = i
    }
  }

  /** Assign an agent's cell before `build`. */
  assign(item: number, x: number, y: number): void {
    this.ensureScratch(item + 1)[item] = this.cellIndex(x, y)
  }

  /**
   * Collect item indices whose cell lies within `radiusCells` cells of
   * (cellX, cellY). Returns how many were written into `out`.
   */
  queryInto(cellX: number, cellY: number, radiusCells: number, out: Int32Array): number {
    const maxOut = out.length
    let written = 0
    const x0 = cellX - radiusCells < 0 ? 0 : cellX - radiusCells
    const x1 = cellX + radiusCells >= this.cols ? this.cols - 1 : cellX + radiusCells
    const y0 = cellY - radiusCells < 0 ? 0 : cellY - radiusCells
    const y1 = cellY + radiusCells >= this.rows ? this.rows - 1 : cellY + radiusCells
    for (let cy = y0; cy <= y1; cy++) {
      const rowBase = cy * this.cols
      for (let cx = x0; cx <= x1; cx++) {
        const cell = rowBase + cx
        const start = this.starts[cell]
        const end = this.starts[cell + 1]
        for (let k = start; k < end; k++) {
          if (written >= maxOut) return written
          out[written++] = this.items[k]
        }
      }
    }
    return written
  }

  countInCell(cell: number): number {
    return this.starts[cell + 1] - this.starts[cell]
  }

  total(): number {
    return this.starts[this.cellCount]
  }

  private ensureScratch(size: number): Int32Array {
    if (this.scratch.length < size) this.scratch = growInt32(this.scratch, size)
    return this.scratch
  }

  private ensureItems(size: number): Int32Array {
    if (this.items.length < size) this.items = growInt32(this.items, size)
    return this.items
  }
}

function growInt32(current: Int32Array, required: number): Int32Array {
  let capacity = current.length * 2 || 1024
  while (capacity < required) capacity *= 2
  const next = new Int32Array(capacity)
  next.set(current)
  return next
}