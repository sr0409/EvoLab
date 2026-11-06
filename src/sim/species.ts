/**
 * Species registry.
 *
 * Species are not declared up front: they emerge from the population. Every
 * creature inherits its parent's species, and a birth whose genome has drifted
 * further from that species' running average than `speciationThreshold` founds a
 * new species with its own name, centroid, generation and origin event.
 *
 * That produces a real branching history (species -> sub-species -> species) with
 * a recorded split event and parent link, which is what the lineage view draws.
 */
import { TRAIT_COUNT, TRAIT_INDEX, genomeDistance, type Genome } from './traits'
import { dietClassOf, type DietClass } from './types'
import type { Rng } from './rng'

export interface SpeciesRecord {
  id: number
  name: string
  /** Genome of the individual that founded this species. */
  foundingGenome: Genome
  /** Running mean genome of living members (also the classification reference). */
  centroid: Genome
  centroidWeight: number
  memberCount: number
  parentSpeciesId: number
  originSpeciesId: number
  originEventId: number
  foundedTick: number
  generation: number
  splits: number
  totalBorn: number
  peakPopulation: number
  lastSeenTick: number
  /** -1 while alive. */
  extinctionTick: number
  diet: DietClass
}

export interface SpeciesSnapshotRecord extends Omit<SpeciesRecord, 'foundingGenome' | 'centroid'> {
  foundingGenome: number[]
  centroid: number[]
}

const GENUS_A = ['velo', 'terra', 'astra', 'nycto', 'pyra', 'glaci', 'silva', 'ferru', 'hydr', 'auro', 'bore', 'censo']
const GENUS_B = ['therm', 'phag', 'sark', 'lith', 'vor', 'morph', 'canth', 'dus', 'sylv', 'ochre', 'basal', 'kry']
const EPITHETS = [
  'primus', 'secundus', 'tertius', 'quartus', 'quintus', 'sextus', 'septimus',
  'minor', 'major', 'medius', 'fuscus', 'niveus', 'viridis', 'atra', 'vulgaris',
  'agilis', 'gracilis', 'robustus', 'formidabilis', 'perplexus', 'audax', 'humilis'
]

export class Species {
  species: SpeciesRecord[] = []
  private usedNames = new Set<string>()

  constructor(private readonly rng: Rng) {}

  get size(): number {
    return this.species.length
  }

  get(id: number): SpeciesRecord | undefined {
    return this.species[id]
  }

  /** Found a new species from a divergent genome. */
  found(genome: Genome, parentSpeciesId: number, tick: number): SpeciesRecord {
    const parent = this.species[parentSpeciesId]
    const record: SpeciesRecord = {
      id: this.species.length,
      name: this.makeName(parent),
      foundingGenome: new Float32Array(genome),
      centroid: new Float32Array(genome),
      centroidWeight: 1,
      memberCount: 0,
      parentSpeciesId,
      originSpeciesId: parent ? parent.originSpeciesId : this.species.length,
      originEventId: parent ? parent.originEventId : -1,
      foundedTick: tick,
      generation: parent ? parent.generation + 1 : 0,
      splits: 0,
      totalBorn: 0,
      peakPopulation: 0,
      lastSeenTick: tick,
      extinctionTick: -1,
      diet: dietClassOf(genome[TRAIT_INDEX.diet])
    }
    this.species.push(record)
    return record
  }

  /**
   * Assign a genome to a species. If it sits too far from its parent species'
   * average, it founds a new one instead.
   */
  assign(
    genome: Genome,
    parentSpeciesId: number,
    threshold: number,
    tick: number
  ): { speciesId: number; isNew: boolean } {
    const parent = this.species[parentSpeciesId]
    if (!parent) {
      const record = this.found(genome, -1, tick)
      return { speciesId: record.id, isNew: true }
    }
    const reference = parent.centroidWeight > 0 ? parent.centroid : parent.foundingGenome
    if (genomeDistance(genome, reference) > threshold) {
      const record = this.found(genome, parentSpeciesId, tick)
      parent.splits++
      return { speciesId: record.id, isNew: true }
    }
    return { speciesId: parentSpeciesId, isNew: false }
  }

  /** Rolling mean of member genomes; this is the speciation reference point. */
  updateCentroid(speciesId: number, genome: Genome): void {
    const record = this.species[speciesId]
    if (!record) return
    const next = record.centroidWeight + 1
    for (let i = 0; i < TRAIT_COUNT; i++) {
      record.centroid[i] = (record.centroid[i] * record.centroidWeight + genome[i]) / next
    }
    record.centroidWeight = next
  }

  census(speciesId: number, count: number, tick: number): void {
    const record = this.species[speciesId]
    if (!record) return
    record.memberCount = count
    if (count > record.peakPopulation) record.peakPopulation = count
    if (count > 0) record.lastSeenTick = tick
  }

  markBorn(speciesId: number): void {
    const record = this.species[speciesId]
    if (record) record.totalBorn++
  }

  extinct(id: number, tick: number): void {
    const record = this.species[id]
    if (!record || record.extinctionTick >= 0) return
    record.extinctionTick = tick
  }

  livingCount(): number {
    let n = 0
    for (const s of this.species) if (s.extinctionTick < 0) n++
    return n
  }

  /** Species whose living count just dropped from >0 to 0. */
  detectExtinctions(previous: Int32Array, current: Int32Array, tick: number): SpeciesRecord[] {
    const found: SpeciesRecord[] = []
    for (let id = 0; id < this.species.length; id++) {
      const record = this.species[id]
      if (record.extinctionTick >= 0) continue
      const before = id < previous.length ? previous[id] : 0
      const now = id < current.length ? current[id] : 0
      if (before > 0 && now === 0) {
        record.extinctionTick = tick
        found.push(record)
      }
    }
    return found
  }

  private makeName(parent?: SpeciesRecord): string {
    const base = parent ? parent.name.split(' ')[0].toLowerCase() : this.pickGenus()
    for (let attempt = 0; attempt < 40; attempt++) {
      const epithet = EPITHETS[this.rng.int(EPITHETS.length)]
      const suffix = attempt > 0 ? ` ${roman(attempt)}` : ''
      const name = `${capitalize(base)} ${epithet}${suffix}`
      if (!this.usedNames.has(name)) {
        this.usedNames.add(name)
        return name
      }
    }
    const fallback = `${capitalize(this.pickGenus())} ${EPITHETS[this.rng.int(EPITHETS.length)]} ${roman(this.species.length + 1)}`
    this.usedNames.add(fallback)
    return fallback
  }

  private pickGenus(): string {
    return GENUS_A[this.rng.int(GENUS_A.length)] + GENUS_B[this.rng.int(GENUS_B.length)]
  }

  snapshot(): { records: SpeciesSnapshotRecord[]; usedNames: string[] } {
    return {
      records: this.species.map((s) => ({
        ...s,
        foundingGenome: Array.from(s.foundingGenome),
        centroid: Array.from(s.centroid)
      })),
      usedNames: Array.from(this.usedNames)
    }
  }

  restore(data: { records: SpeciesSnapshotRecord[]; usedNames: string[] } | null | undefined): void {
    this.species = (data?.records ?? []).map((raw) => ({
      ...raw,
      foundingGenome: Float32Array.from(raw.foundingGenome),
      centroid: Float32Array.from(raw.centroid)
    }))
    this.usedNames = new Set(data?.usedNames ?? [])
  }
}

function capitalize(text: string): string {
  return text.length ? text[0].toUpperCase() + text.slice(1) : text
}

function roman(value: number): string {
  const numerals = ['ii', 'iii', 'iv', 'v', 'vi', 'vii', 'viii', 'ix', 'x', 'xi', 'xii', 'xiii', 'xiv', 'xv']
  return numerals[Math.max(0, Math.min(numerals.length - 1, value - 1))] ?? String(value)
}