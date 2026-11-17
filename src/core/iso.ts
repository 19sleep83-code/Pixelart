// The isometric projection. World positions are in tiles (x runs down-right on screen, y down-left),
// heights are in voxels. One tile is a 32×16 px diamond, which is 16 voxels along each side.

export const TW = 32
export const TH = 16
export const VOX_PER_TILE = 16
/** screen pixels per voxel of height */
export const KZ = 1.25

/** world (tiles, z in voxels) → world pixels (before the camera) */
export function isoX(x: number, y: number): number {
  return (x - y) * (TW / 2)
}
export function isoY(x: number, y: number, z = 0): number {
  return (x + y) * (TH / 2) - z * KZ
}

/** world pixels on the ground plane → world tiles */
export function unIso(sx: number, sy: number): { x: number; y: number } {
  const a = sx / (TW / 2)
  const b = sy / (TH / 2)
  return { x: (a + b) / 2, y: (b - a) / 2 }
}

// colour helpers: models use 0xRRGGBB, pixel buffers 0xAABBGGRR (little endian ImageData)
export function rgb(r: number, g: number, b: number): number {
  return ((r & 255) << 16) | ((g & 255) << 8) | (b & 255)
}
export function hex(s: string): number {
  return parseInt(s.replace('#', ''), 16)
}
export function toABGR(c: number, a = 255): number {
  return ((a << 24) | ((c & 255) << 16) | (c & 0xff00) | ((c >> 16) & 255)) >>> 0
}
export function shade(c: number, k: number): number {
  const r = Math.min(255, Math.max(0, Math.round(((c >> 16) & 255) * k)))
  const g = Math.min(255, Math.max(0, Math.round(((c >> 8) & 255) * k)))
  const b = Math.min(255, Math.max(0, Math.round((c & 255) * k)))
  return rgb(r, g, b)
}
export function mix(c1: number, c2: number, t: number): number {
  const r = ((c1 >> 16) & 255) * (1 - t) + ((c2 >> 16) & 255) * t
  const g = ((c1 >> 8) & 255) * (1 - t) + ((c2 >> 8) & 255) * t
  const b = (c1 & 255) * (1 - t) + (c2 & 255) * t
  return rgb(Math.round(r), Math.round(g), Math.round(b))
}
export function css(c: number, a = 1): string {
  return a >= 1 ? '#' + c.toString(16).padStart(6, '0') : `rgba(${(c >> 16) & 255},${(c >> 8) & 255},${c & 255},${a})`
}
