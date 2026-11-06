/**
 * Deterministic procedural noise used for terrain generation.
 *
 * Noise here is derived from an integer hash of lattice coordinates, not from a
 * permutation table, so it can be sampled by any code (including tests) without
 * having to share a random stream. Two identical (coordinate, seed) inputs always
 * produce the same output.
 */

/** Hash a lattice point to a float in [0, 1). */
export function hash2(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(seed | 0, 1274126177)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  h = Math.imul(h ^ (h >>> 16), 2654435769) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

/** Second, decorrelated hash so a single field can combine two noise bases. */
export function hash2b(x: number, y: number, seed: number): number {
  return hash2((x | 0) + 19349663, (y | 0) - 98117511, (seed | 0) ^ 0x5bf03635)
}

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t)
}

/** Bilinearly interpolated value noise in [0, 1). `scale` is the cell size in world units. */
export function valueNoise(x: number, y: number, scale: number, seed: number): number {
  const gx = x / scale
  const gy = y / scale
  const x0 = Math.floor(gx)
  const y0 = Math.floor(gy)
  const tx = smoothstep(gx - x0)
  const ty = smoothstep(gy - y0)
  const v00 = hash2(x0, y0, seed)
  const v10 = hash2(x0 + 1, y0, seed)
  const v01 = hash2(x0, y0 + 1, seed)
  const v11 = hash2(x0 + 1, y0 + 1, seed)
  const top = v00 + (v10 - v00) * tx
  const bottom = v01 + (v11 - v01) * tx
  return top + (bottom - top) * ty
}

/**
 * Fractal brownian motion: a few octaves of value noise summed with decreasing
 * amplitude. Normalised to [0, 1] so callers can treat the result as a height or
 * moisture field without knowing the octave count.
 */
export function fbm(
  x: number,
  y: number,
  seed: number,
  options: { octaves?: number; baseScale?: number; lacunarity?: number; gain?: number } = {}
): number {
  const octaves = options.octaves ?? 4
  const baseScale = options.baseScale ?? 32
  const lacunarity = options.lacunarity ?? 2
  const gain = options.gain ?? 0.5
  let sum = 0
  let amplitude = 1
  let total = 0
  let scale = baseScale
  for (let o = 0; o < octaves; o++) {
    sum += amplitude * valueNoise(x, y, scale, seed + o * 7919)
    total += amplitude
    amplitude *= gain
    scale /= lacunarity
  }
  return total > 0 ? sum / total : 0
}

/** Ridged variant: sharper crests, used for mountain ranges. */
export function ridgedFbm(x: number, y: number, seed: number, octaves = 4, baseScale = 28): number {
  let sum = 0
  let amplitude = 1
  let total = 0
  let scale = baseScale
  for (let o = 0; o < octaves; o++) {
    const n = valueNoise(x, y, scale, seed + o * 6151)
    const ridge = 1 - Math.abs(n * 2 - 1)
    sum += amplitude * ridge * ridge
    total += amplitude
    amplitude *= 0.5
    scale /= 2
  }
  return total > 0 ? sum / total : 0
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

/** Normalised falloff: 1 at the centre, 0 at radius 1. */
export function radialFalloff(x: number, y: number, cx: number, cy: number, radius: number): number {
  const dx = (x - cx) / radius
  const dy = (y - cy) / radius
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d >= 1) return 0
  const t = 1 - d
  return t * t * (3 - 2 * t)
}
