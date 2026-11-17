// Voxel models and the renderer that turns them into pixel-art sprites.
//
// A model is a small grid of coloured voxels. To draw it at a heading, every visible voxel is
// turned, projected into the isometric view and splatted into a tiny pixel buffer with a depth
// test. Each voxel is lit by the way its surface faces the sun, in a few hard tones, and the
// result is inked like hand-made pixel art: a darker line round the silhouette and a shadow line
// wherever one part stands in front of another. Sprites are rendered once at load time for a
// fixed set of headings and then simply blitted.

import { KZ, shade, mix, toABGR } from './iso'

const SOLID = 0x1000000
const GLOW = 0x2000000

/** where the sun is: the direction pointing towards it (world x, y, z) */
export const SUN = (() => {
  const v = [-0.62, -0.3, 0.73]
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
})()

export class Vox {
  data: Uint32Array
  /** the pivot, in voxels from the model's corner: the point that sits on the unit's position */
  px: number
  py: number
  pz = 0
  private shellCache: Shell | null = null

  constructor(public w: number, public l: number, public h: number) {
    this.data = new Uint32Array(w * l * h)
    this.px = w / 2
    this.py = l / 2
  }

  inside(x: number, y: number, z: number) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.w && y < this.l && z < this.h
  }
  get(x: number, y: number, z: number): number {
    if (!this.inside(x, y, z)) return 0
    return this.data[(z * this.l + y) * this.w + x]
  }
  /** colour 0xRRGGBB; pass -1 to clear the voxel */
  set(x: number, y: number, z: number, c: number, glow = false) {
    x = Math.round(x)
    y = Math.round(y)
    z = Math.round(z)
    if (!this.inside(x, y, z)) return
    this.shellCache = null
    this.data[(z * this.l + y) * this.w + x] = c < 0 ? 0 : (c & 0xffffff) | SOLID | (glow ? GLOW : 0)
  }
  /** a solid box, corners inclusive */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, glow = false) {
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1)
    const ay = Math.min(y0, y1), by = Math.max(y0, y1)
    const az = Math.min(z0, z1), bz = Math.max(z0, z1)
    for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) this.set(x, y, z, c, glow)
  }
  /** an upright cylinder */
  cylZ(cx: number, cy: number, r: number, z0: number, z1: number, c: number) {
    for (let z = z0; z <= z1; z++)
      for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy
          if (dx * dx + dy * dy <= r * r) this.set(x, y, z, c)
        }
  }
  /** a cylinder lying along the model's length (barrels, tubes) */
  cylY(cx: number, cz: number, r: number, y0: number, y1: number, c: number) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
        for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
          const dx = x + 0.5 - cx, dz = z + 0.5 - cz
          if (dx * dx + dz * dz <= r * r) this.set(x, y, z, c)
        }
  }
  /** a cylinder lying across the model */
  cylX(cy: number, cz: number, r: number, x0: number, x1: number, c: number) {
    for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
      for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++)
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
          const dy = y + 0.5 - cy, dz = z + 0.5 - cz
          if (dy * dy + dz * dz <= r * r) this.set(x, y, z, c)
        }
  }
  /** an ellipsoid round a centre */
  ball(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number) {
    for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++)
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
          const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry, dz = (z + 0.5 - cz) / rz
          if (dx * dx + dy * dy + dz * dz <= 1) this.set(x, y, z, c)
        }
  }
  /** recolour every solid voxel: return a new colour, the same, or -1 to remove it */
  paint(fn: (x: number, y: number, z: number, c: number) => number) {
    for (let z = 0; z < this.h; z++)
      for (let y = 0; y < this.l; y++)
        for (let x = 0; x < this.w; x++) {
          const v = this.data[(z * this.l + y) * this.w + x]
          if (!v) continue
          const n = fn(x, y, z, v & 0xffffff)
          if (n !== (v & 0xffffff)) this.set(x, y, z, n, (v & GLOW) !== 0)
        }
  }
  /** the visible shell with a surface normal per voxel, relative to the pivot */
  shell(): Shell {
    if (this.shellCache) return this.shellCache
    const xs: number[] = [], ys: number[] = [], zs: number[] = []
    const cs: number[] = [], nxs: number[] = [], nys: number[] = [], nzs: number[] = []
    let reach = 0, top = 0, bottom = 0
    const full = (x: number, y: number, z: number) => this.get(x, y, z) !== 0
    for (let z = 0; z < this.h; z++)
      for (let y = 0; y < this.l; y++)
        for (let x = 0; x < this.w; x++) {
          const v = this.data[(z * this.l + y) * this.w + x]
          if (!v) continue
          if (full(x - 1, y, z) && full(x + 1, y, z) && full(x, y - 1, z) && full(x, y + 1, z) && full(x, y, z - 1) && full(x, y, z + 1)) continue
          let nx = 0, ny = 0, nz = 0
          for (let dz = -1; dz <= 1; dz++)
            for (let dy = -1; dy <= 1; dy++)
              for (let dx = -1; dx <= 1; dx++) {
                if ((!dx && !dy && !dz) || full(x + dx, y + dy, z + dz)) continue
                const w = 1 / (dx * dx + dy * dy + dz * dz)
                nx += dx * w
                ny += dy * w
                nz += dz * w
              }
          const l = Math.hypot(nx, ny, nz) || 1
          const mx = x + 0.5 - this.px, my = y + 0.5 - this.py, mz = z + 0.5 - this.pz
          xs.push(mx); ys.push(my); zs.push(mz)
          cs.push(v)
          nxs.push(nx / l); nys.push(ny / l); nzs.push(nz / l)
          reach = Math.max(reach, Math.hypot(mx, my) + 1)
          top = Math.max(top, mz + 1)
          bottom = Math.min(bottom, mz - 1)
        }
    this.shellCache = {
      n: xs.length,
      x: Float32Array.from(xs), y: Float32Array.from(ys), z: Float32Array.from(zs),
      c: Uint32Array.from(cs),
      nx: Float32Array.from(nxs), ny: Float32Array.from(nys), nz: Float32Array.from(nzs),
      reach, top, bottom,
    }
    return this.shellCache
  }
}

export interface Shell {
  n: number
  x: Float32Array
  y: Float32Array
  z: Float32Array
  c: Uint32Array
  nx: Float32Array
  ny: Float32Array
  nz: Float32Array
  reach: number
  top: number
  bottom: number
}

export interface Sprite {
  cv: HTMLCanvasElement
  /** the pivot's place inside the canvas */
  ax: number
  ay: number
  w: number
  h: number
}

export function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = Math.max(1, w)
  c.height = Math.max(1, h)
  return c
}

export interface RenderOpts {
  /** multiply every colour (wrecks are drawn dark) */
  dark?: number
  /** draw the dark line round the figure */
  outline?: boolean
  /** recolour before lighting */
  tint?: (c: number) => number
  /** voxel size in screen pixels along the ground (1 = native) */
  scale?: number
}

const TONE_DARK = 0x283850

/** render a model at a heading (radians; 0 faces world +x, π/2 faces world +y) */
export function renderSprite(m: Vox, yaw: number, o: RenderOpts = {}): Sprite {
  const s = m.shell()
  const sc = o.scale ?? 1
  const cs = Math.cos(yaw), sn = Math.sin(yaw)
  const R = s.reach * sc
  const W = Math.ceil(2.84 * R) + 8
  const ax = W >> 1
  const ay = Math.ceil(0.71 * R + s.top * KZ * sc) + 4
  const H = ay + Math.ceil(0.71 * R - s.bottom * KZ * sc) + 5
  const col = new Uint32Array(W * H)
  const dep = new Float32Array(W * H).fill(-1e9)
  const has = new Uint8Array(W * H)

  // sample points inside a voxel, so a turned voxel leaves no gaps
  const ns = sc > 1.5 ? 4 : 3
  const offs: number[] = []
  for (let a = 0; a < ns; a++)
    for (let b = 0; b < ns; b++)
      for (let c = 0; c < ns; c++) {
        const ox = ((a + 0.5) / ns - 0.5) * sc, oy = ((b + 0.5) / ns - 0.5) * sc, oz = ((c + 0.5) / ns - 0.5) * sc
        const rx = -ox * sn + oy * cs
        const ry = ox * cs + oy * sn
        offs.push(rx - ry, (rx + ry) * 0.5 - oz * KZ, (rx + ry) * 0.612 + oz * 0.5)
      }
  const no = offs.length / 3
  const dark = o.dark ?? 1

  for (let v = 0; v < s.n; v++) {
    const mx = s.x[v] * sc, my = s.y[v] * sc, mz = s.z[v] * sc
    const rx = -mx * sn + my * cs
    const ry = mx * cs + my * sn
    const bx = ax + rx - ry
    const by = ay + (rx + ry) * 0.5 - mz * KZ
    const bd = (rx + ry) * 0.612 + mz * 0.5
    const raw = s.c[v]
    let c = raw & 0xffffff
    if (o.tint) c = o.tint(c)
    if (!(raw & GLOW)) {
      // light by the way the surface faces the sun, in hard tones
      const nwx = -s.nx[v] * sn + s.ny[v] * cs
      const nwy = s.nx[v] * cs + s.ny[v] * sn
      const b = nwx * SUN[0] + nwy * SUN[1] + s.nz[v] * SUN[2]
      const k = b > 0.55 ? 1.12 : b > 0.08 ? 1 : b > -0.38 ? 0.8 : 0.64
      c = shade(c, k)
      if (k < 0.9) c = mix(c, TONE_DARK, k < 0.7 ? 0.14 : 0.07)
    }
    if (dark !== 1) c = mix(shade(c, dark), 0x202020, 0.35)
    for (let i = 0; i < no; i++) {
      const x = Math.round(bx + offs[i * 3])
      const y = Math.round(by + offs[i * 3 + 1])
      if (x < 1 || y < 1 || x >= W - 1 || y >= H - 1) continue
      const at = y * W + x
      const d = bd + offs[i * 3 + 2]
      if (has[at] && dep[at] >= d) continue
      has[at] = 1
      dep[at] = d
      col[at] = c
    }
  }

  // ink: shadow lines where a part stands in front of another, and a line round the figure
  const out = new Uint32Array(W * H)
  const gap = 2.2 * sc
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const at = y * W + x
      if (has[at]) {
        let c = col[at]
        const d = dep[at] + gap
        if (
          (x > 0 && has[at - 1] && dep[at - 1] > d) ||
          (x < W - 1 && has[at + 1] && dep[at + 1] > d) ||
          (y > 0 && has[at - W] && dep[at - W] > d) ||
          (y < H - 1 && has[at + W] && dep[at + W] > d)
        )
          c = mix(c, 0x10141c, 0.42)
        out[at] = toABGR(c)
      } else if (o.outline !== false) {
        let n = -1
        if (x > 0 && has[at - 1]) n = at - 1
        else if (x < W - 1 && has[at + 1]) n = at + 1
        else if (y > 0 && has[at - W]) n = at - W
        else if (y < H - 1 && has[at + W]) n = at + W
        if (n >= 0) out[at] = toABGR(mix(shade(col[n], 0.32), 0x0c0e14, 0.45))
      }
    }
  return toSprite(out, W, H, ax, ay)
}

/** the shadow the model throws on flat ground at a heading */
export function renderShadow(m: Vox, yaw: number, alpha = 0.34, scale = 1): Sprite {
  const s = m.shell()
  const cs = Math.cos(yaw), sn = Math.sin(yaw)
  const kx = -SUN[0] / SUN[2], ky = -SUN[1] / SUN[2]
  const R = (s.reach + s.top * Math.hypot(kx, ky)) * scale
  const W = Math.ceil(2.84 * R) + 6
  const H = Math.ceil(1.42 * R) + 6
  const ax = W >> 1, ay = H >> 1
  const mask = new Uint8Array(W * H)
  for (let v = 0; v < s.n; v++) {
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const mx = (s.x[v] + a * 0.34) * scale, my = (s.y[v] + b * 0.34) * scale, mz = Math.max(0, s.z[v] * scale)
        const rx = -mx * sn + my * cs + mz * kx
        const ry = mx * cs + my * sn + mz * ky
        const x = Math.round(ax + rx - ry)
        const y = Math.round(ay + (rx + ry) * 0.5)
        if (x >= 0 && y >= 0 && x < W && y < H) mask[y * W + x] = 1
      }
  }
  const out = new Uint32Array(W * H)
  const c = toABGR(0x101c14, Math.round(alpha * 255))
  for (let i = 0; i < out.length; i++) if (mask[i]) out[i] = c
  return toSprite(out, W, H, ax, ay)
}

export function toSprite(px: Uint32Array, W: number, H: number, ax: number, ay: number): Sprite {
  const cv = makeCanvas(W, H)
  const ctx = cv.getContext('2d')!
  const img = ctx.createImageData(W, H)
  new Uint32Array(img.data.buffer).set(px)
  ctx.putImageData(img, 0, 0)
  return { cv, ax, ay, w: W, h: H }
}

/** a set of sprites for evenly spaced headings */
export class Rot {
  sprites: Sprite[] = []
  shadows: Sprite[] = []
  constructor(public m: Vox, public dirs: number, o: RenderOpts = {}, shadows = true) {
    for (let i = 0; i < dirs; i++) {
      const a = (i / dirs) * Math.PI * 2
      this.sprites.push(renderSprite(m, a, o))
      if (shadows) this.shadows.push(renderShadow(m, a))
    }
  }
  index(yaw: number): number {
    const t = yaw / (Math.PI * 2)
    return ((Math.round(t * this.dirs) % this.dirs) + this.dirs) % this.dirs
  }
  at(yaw: number): Sprite {
    return this.sprites[this.index(yaw)]
  }
  shadowAt(yaw: number): Sprite {
    return this.shadows[this.index(yaw)]
  }
}
