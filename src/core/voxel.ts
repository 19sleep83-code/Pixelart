// Voxel models and the renderer that turns them into pixel-art sprites.
//
// A model is a small grid of coloured voxels. To draw it at a heading, every visible voxel is
// turned, projected into the isometric view and splatted into a tiny pixel buffer with a depth
// test. Each voxel is lit by the way its surface faces the sun, in a few hard tones, and the
// result is inked like hand-made pixel art: a darker line round the silhouette and a shadow line
// wherever one part stands in front of another. Sprites are rendered once at load time for a
// fixed set of headings and then simply blitted.
//
// Models are written in "units" (16 to a tile), but stored at a finer resolution: RES fine voxels
// to a unit along each axis. Boxes fill whole units; cylinders, balls and anything placed at
// half-unit coordinates use the fine grid, so round things come out round and small things small.

import { KZ, SCALE, shade, mix, toABGR } from './iso'

const SOLID = 0x1000000
const GLOW = 0x2000000

/** fine voxels per unit along each axis */
export const RES = 2

/** where the sun is: the direction pointing towards it (world x, y, z) */
export const SUN = (() => {
  const v = [-0.62, -0.3, 0.73]
  const l = Math.hypot(v[0], v[1], v[2])
  return [v[0] / l, v[1] / l, v[2] / l]
})()

export class Vox {
  data: Uint32Array
  /** the fine grid's size */
  W: number
  L: number
  H: number
  res: number
  /** the pivot, in units from the model's corner: the point that sits on the unit's position */
  px: number
  py: number
  pz = 0
  private shellCache: Shell | null = null

  /** a model w × l × h units in size */
  constructor(public w: number, public l: number, public h: number, res = RES) {
    this.res = res
    this.W = Math.ceil(w * res)
    this.L = Math.ceil(l * res)
    this.H = Math.ceil(h * res)
    this.data = new Uint32Array(this.W * this.L * this.H)
    this.px = w / 2
    this.py = l / 2
  }

  /** write one fine voxel (models in world axes swap x and y here) */
  protected put(fx: number, fy: number, fz: number, v: number) {
    if (fx < 0 || fy < 0 || fz < 0 || fx >= this.W || fy >= this.L || fz >= this.H) return
    this.shellCache = null
    this.data[(fz * this.L + fy) * this.W + fx] = v
  }
  private enc(c: number, glow: boolean) {
    return c < 0 ? 0 : (c & 0xffffff) | SOLID | (glow ? GLOW : 0)
  }

  /** is the unit cell (or the fine voxel at a fractional position) solid */
  get(x: number, y: number, z: number): number {
    const fx = Math.floor(x * this.res), fy = Math.floor(y * this.res), fz = Math.floor(z * this.res)
    if (fx < 0 || fy < 0 || fz < 0 || fx >= this.W || fy >= this.L || fz >= this.H) return 0
    return this.data[(fz * this.L + fy) * this.W + fx]
  }

  /**
   * One voxel of a unit's size; colour 0xRRGGBB, -1 clears. Fractional positions snap to the
   * fine grid, so a part can sit half a unit over.
   */
  set(x: number, y: number, z: number, c: number, glow = false) {
    const r = this.res
    const fx = Math.round(x * r), fy = Math.round(y * r), fz = Math.round(z * r)
    const v = this.enc(c, glow)
    for (let k = 0; k < r; k++) for (let j = 0; j < r; j++) for (let i = 0; i < r; i++) this.put(fx + i, fy + j, fz + k, v)
  }

  /** one fine voxel: the smallest detail there is */
  dot(x: number, y: number, z: number, c: number, glow = false) {
    this.put(Math.floor(x * this.res), Math.floor(y * this.res), Math.floor(z * this.res), this.enc(c, glow))
  }

  /** a solid box, corners inclusive (in units) */
  box(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, glow = false) {
    const r = this.res
    const ax = Math.round(Math.min(x0, x1) * r), bx = Math.round((Math.max(x0, x1) + 1) * r) - 1
    const ay = Math.round(Math.min(y0, y1) * r), by = Math.round((Math.max(y0, y1) + 1) * r) - 1
    const az = Math.round(Math.min(z0, z1) * r), bz = Math.round((Math.max(z0, z1) + 1) * r) - 1
    const v = this.enc(c, glow)
    for (let z = az; z <= bz; z++) for (let y = ay; y <= by; y++) for (let x = ax; x <= bx; x++) this.put(x, y, z, v)
  }

  /** a thin rod of fine voxels from one point to another (antennas, barrels, cables, railings) */
  rod(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, c: number, glow = false) {
    const r = this.res
    const n = Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0)) * r) + 1
    for (let k = 0; k <= n; k++) {
      const t = k / n
      this.dot(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, c, glow)
    }
  }

  private fill(test: (x: number, y: number, z: number) => boolean, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, c: number) {
    const r = this.res
    const v = this.enc(c, false)
    for (let fz = Math.floor(z0 * r); fz < Math.ceil(z1 * r); fz++)
      for (let fy = Math.floor(y0 * r); fy < Math.ceil(y1 * r); fy++)
        for (let fx = Math.floor(x0 * r); fx < Math.ceil(x1 * r); fx++) {
          if (test((fx + 0.5) / r, (fy + 0.5) / r, (fz + 0.5) / r)) this.put(fx, fy, fz, v)
        }
  }

  /** an upright cylinder from z0 to z1 (inclusive, in units) */
  cylZ(cx: number, cy: number, rad: number, z0: number, z1: number, c: number) {
    this.fill((x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= rad * rad, cx - rad - 1, cx + rad + 1, cy - rad - 1, cy + rad + 1, z0, z1 + 1, c)
  }
  /** a cylinder lying along the model's length (barrels, tubes) */
  cylY(cx: number, cz: number, rad: number, y0: number, y1: number, c: number) {
    this.fill((x, _y, z) => (x - cx) ** 2 + (z - cz) ** 2 <= rad * rad, cx - rad - 1, cx + rad + 1, Math.min(y0, y1), Math.max(y0, y1) + 1, cz - rad - 1, cz + rad + 1, c)
  }
  /** a cylinder lying across the model (wheels, drums) */
  cylX(cy: number, cz: number, rad: number, x0: number, x1: number, c: number) {
    this.fill((_x, y, z) => (y - cy) ** 2 + (z - cz) ** 2 <= rad * rad, Math.min(x0, x1), Math.max(x0, x1) + 1, cy - rad - 1, cy + rad + 1, cz - rad - 1, cz + rad + 1, c)
  }
  /** an ellipsoid round a centre */
  ball(cx: number, cy: number, cz: number, rx: number, ry: number, rz: number, c: number) {
    this.fill(
      (x, y, z) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 + ((z - cz) / rz) ** 2 <= 1,
      cx - rx - 1, cx + rx + 1, cy - ry - 1, cy + ry + 1, cz - rz - 1, cz + rz + 1, c,
    )
  }
  /** recolour every solid voxel: return a new colour, the same, or -1 to remove it (coordinates in units) */
  paint(fn: (x: number, y: number, z: number, c: number) => number) {
    const r = this.res
    for (let z = 0; z < this.H; z++)
      for (let y = 0; y < this.L; y++)
        for (let x = 0; x < this.W; x++) {
          const at = (z * this.L + y) * this.W + x
          const v = this.data[at]
          if (!v) continue
          const n = fn(x / r, y / r, z / r, v & 0xffffff)
          if (n !== (v & 0xffffff)) {
            this.data[at] = n < 0 ? 0 : (n & 0xffffff) | SOLID | (v & GLOW)
            this.shellCache = null
          }
        }
  }

  /** the visible shell with a surface normal per fine voxel, relative to the pivot, in units */
  shell(): Shell {
    if (this.shellCache) return this.shellCache
    const { W, L, H, res } = this
    const xs: number[] = [], ys: number[] = [], zs: number[] = []
    const cs: number[] = [], nxs: number[] = [], nys: number[] = [], nzs: number[] = []
    let reach = 0, top = 0, bottom = 0
    const d = this.data
    const full = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < W && y < L && z < H && d[(z * L + y) * W + x] !== 0
    for (let z = 0; z < H; z++)
      for (let y = 0; y < L; y++)
        for (let x = 0; x < W; x++) {
          const v = d[(z * L + y) * W + x]
          if (!v) continue
          if (full(x - 1, y, z) && full(x + 1, y, z) && full(x, y - 1, z) && full(x, y + 1, z) && full(x, y, z - 1) && full(x, y, z + 1)) continue
          // the normal points away from the solid around it, looked at over two fine voxels
          let nx = 0, ny = 0, nz = 0
          for (let dz = -2; dz <= 2; dz++)
            for (let dy = -2; dy <= 2; dy++)
              for (let dx = -2; dx <= 2; dx++) {
                if ((!dx && !dy && !dz) || full(x + dx, y + dy, z + dz)) continue
                const w = 1 / (dx * dx + dy * dy + dz * dz)
                nx += dx * w
                ny += dy * w
                nz += dz * w
              }
          const l = Math.hypot(nx, ny, nz) || 1
          const mx = (x + 0.5) / res - this.px, my = (y + 0.5) / res - this.py, mz = (z + 0.5) / res - this.pz
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
      reach, top, bottom, res,
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
  res: number
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
  /** screen pixels per unit along the ground (default: the game's scale) */
  scale?: number
}

const TONE_DARK = 0x283850

/** render a model at a heading (radians; 0 faces world +x, π/2 faces world +y) */
export function renderSprite(m: Vox, yaw: number, o: RenderOpts = {}): Sprite {
  const s = m.shell()
  const sc = o.scale ?? SCALE
  const kz = (KZ / SCALE) * sc
  const cs = Math.cos(yaw), sn = Math.sin(yaw)
  const R = s.reach * sc
  const W = Math.ceil(2.84 * R) + 8
  const ax = W >> 1
  const ay = Math.ceil(0.71 * R + s.top * kz) + 4
  const H = ay + Math.ceil(0.71 * R - s.bottom * kz) + 5
  const col = new Uint32Array(W * H)
  const dep = new Float32Array(W * H).fill(-1e9)
  const has = new Uint8Array(W * H)

  // sample points inside a fine voxel, so a turned voxel leaves no gaps
  const vs = sc / s.res // the size of a fine voxel on screen
  const ns = vs > 1.6 ? 3 : 2
  const offs: number[] = []
  for (let a = 0; a < ns; a++)
    for (let b = 0; b < ns; b++)
      for (let c = 0; c < ns; c++) {
        const ox = ((a + 0.5) / ns - 0.5) * vs, oy = ((b + 0.5) / ns - 0.5) * vs, oz = ((c + 0.5) / ns - 0.5) * vs
        const rx = -ox * sn + oy * cs
        const ry = ox * cs + oy * sn
        offs.push(rx - ry, (rx + ry) * 0.5 - oz * (kz / sc), (rx + ry) * 0.612 + oz * 0.5)
      }
  const no = offs.length / 3
  const dark = o.dark ?? 1

  for (let v = 0; v < s.n; v++) {
    const mx = s.x[v] * sc, my = s.y[v] * sc, mz = s.z[v]
    const rx = -mx * sn + my * cs
    const ry = mx * cs + my * sn
    const bx = ax + rx - ry
    const by = ay + (rx + ry) * 0.5 - mz * kz
    const bd = (rx + ry) * 0.612 + mz * sc * 0.5
    const raw = s.c[v]
    let c = raw & 0xffffff
    if (o.tint) c = o.tint(c)
    if (!(raw & GLOW)) {
      // light by the way the surface faces the sun, in hard tones
      const nwx = -s.nx[v] * sn + s.ny[v] * cs
      const nwy = s.nx[v] * cs + s.ny[v] * sn
      const b = nwx * SUN[0] + nwy * SUN[1] + s.nz[v] * SUN[2]
      const k = b > 0.6 ? 1.14 : b > 0.25 ? 1.05 : b > -0.1 ? 0.95 : b > -0.45 ? 0.8 : 0.66
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
export function renderShadow(m: Vox, yaw: number, alpha = 0.34, scale = SCALE): Sprite {
  const s = m.shell()
  const cs = Math.cos(yaw), sn = Math.sin(yaw)
  const kx = -SUN[0] / SUN[2], ky = -SUN[1] / SUN[2]
  const R = (s.reach + s.top * Math.hypot(kx, ky)) * scale
  const W = Math.ceil(2.84 * R) + 6
  const H = Math.ceil(1.42 * R) + 6
  const ax = W >> 1, ay = H >> 1
  const mask = new Uint8Array(W * H)
  const step = 0.34 / s.res
  for (let v = 0; v < s.n; v++) {
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const mx = (s.x[v] + a * step) * scale, my = (s.y[v] + b * step) * scale, mz = Math.max(0, s.z[v] * scale)
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
