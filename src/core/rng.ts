// Seeded random numbers and value noise. Everything random about a map comes from here,
// so the same seed always gives the same landscape.

export type Rand = () => number

export function mulberry32(seed: number): Rand {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** a stable pseudo-random value in [0,1) for integer coordinates */
export function hash2(x: number, y: number, s = 0): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 2147483647)) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

export function hash3(x: number, y: number, z: number): number {
  return hash2(x + Math.imul(z | 0, 7919), y - Math.imul(z | 0, 104729), z)
}

/** smooth value noise sampled at real coordinates; `cell` is the size of one lattice cell */
export function valueNoise(x: number, y: number, cell: number, seed: number): number {
  const fx = x / cell
  const fy = y / cell
  const ix = Math.floor(fx)
  const iy = Math.floor(fy)
  const tx = fx - ix
  const ty = fy - iy
  const sx = tx * tx * (3 - 2 * tx)
  const sy = ty * ty * (3 - 2 * ty)
  const a = hash2(ix, iy, seed)
  const b = hash2(ix + 1, iy, seed)
  const c = hash2(ix, iy + 1, seed)
  const d = hash2(ix + 1, iy + 1, seed)
  return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy
}

/** a few octaves of value noise, roughly in [0,1) */
export function fbm(x: number, y: number, cell: number, seed: number, octaves = 4): number {
  let sum = 0
  let amp = 1
  let norm = 0
  let c = cell
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x, y, c, seed + o * 31) * amp
    norm += amp
    amp *= 0.5
    c *= 0.5
  }
  return sum / norm
}

export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v)
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
