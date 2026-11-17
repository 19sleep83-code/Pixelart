// The weather and the light over the battlefield: glinting water and surf on the shores, cloud
// shadows drifting over the land, the colour of the hour (day, dusk, night) with lights that
// glow in the dark, rain with the odd flash of lightning, and a fine film grain.

import type { GameMap } from './map'
import { Ter } from './map'
import type { TimeOfDay, Weather } from './game'
import { hash2, fbm } from '../core/rng'
import { makeCanvas } from '../core/voxel'
import { TW, TH } from '../core/iso'

export interface Light {
  x: number
  y: number
  r: number
  color: string
  a: number
}

interface Drop {
  x: number
  y: number
  v: number
  l: number
}

export class Atmos {
  /** foam points along every shore, in world pixels, per water tile */
  private foam: (Float32Array | undefined)[]
  private cloud: HTMLCanvasElement
  private grain: HTMLCanvasElement[] = []
  private drops: Drop[] = []
  private flash = 0
  private nextBolt = 6
  private gi = 0

  constructor(public map: GameMap, public tod: TimeOfDay, public weather: Weather) {
    const N = map.N
    this.foam = new Array(N * N)
    const land = (x: number, y: number) => map.inMap(x, y) && map.ter[map.idx(x, y)] !== Ter.Water && map.ter[map.idx(x, y)] !== Ter.Bridge
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = map.idx(x, y)
        if (map.ter[i] !== Ter.Water) continue
        const pts: number[] = []
        const edge = (ax: number, ay: number, bx: number, by: number, nx: number, ny: number) => {
          for (let k = 0; k < 8; k++) {
            const t = (k + 0.5) / 8
            const wx = ax + (bx - ax) * t + nx * 0.07, wy = ay + (by - ay) * t + ny * 0.07
            pts.push((wx - wy) * (TW / 2), (wx + wy) * (TH / 2))
          }
        }
        if (land(x - 1, y)) edge(x, y, x, y + 1, 1, 0)
        if (land(x + 1, y)) edge(x + 1, y, x + 1, y + 1, -1, 0)
        if (land(x, y - 1)) edge(x, y, x + 1, y, 0, 1)
        if (land(x, y + 1)) edge(x, y + 1, x + 1, y + 1, 0, -1)
        if (pts.length) this.foam[i] = Float32Array.from(pts)
      }
    // a tileable sheet of soft cloud shadow
    const S = 128
    this.cloud = makeCanvas(S, S)
    const c = this.cloud.getContext('2d')!
    const img = c.createImageData(S, S)
    const d = new Uint32Array(img.data.buffer)
    const cover = weather === 'clear' ? 0.66 : weather === 'clouds' ? 0.5 : 0.42
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        // tileable: blend the noise with its wrapped copies
        const n =
          fbm(x, y, 40, 77, 3) * (1 - x / S) * (1 - y / S) +
          fbm(x - S, y, 40, 77, 3) * (x / S) * (1 - y / S) +
          fbm(x, y - S, 40, 77, 3) * (1 - x / S) * (y / S) +
          fbm(x - S, y - S, 40, 77, 3) * (x / S) * (y / S)
        const a = Math.max(0, Math.min(1, (n - cover) * 6))
        d[y * S + x] = (Math.round(a * 70) << 24) | 0x0d120f
      }
    c.putImageData(img, 0, 0)
    // film grain frames
    for (let f = 0; f < 4; f++) {
      const g = makeCanvas(96, 96)
      const gc = g.getContext('2d')!
      const gi = gc.createImageData(96, 96)
      const gd = new Uint32Array(gi.data.buffer)
      for (let k = 0; k < gd.length; k++) {
        const v = hash2(k, f, 31)
        const lum = v > 0.5 ? 255 : 0
        gd[k] = v > 0.35 && v < 0.65 ? 0 : (Math.round(Math.abs(v - 0.5) * 2 * 26) << 24) | (lum << 16) | (lum << 8) | lum
      }
      gc.putImageData(gi, 0, 0)
      this.grain.push(g)
    }
  }

  /** glints on the water and surf rolling onto the shores */
  water(ctx: CanvasRenderingContext2D, camX: number, camY: number, t: number, tx0: number, ty0: number, tx1: number, ty1: number) {
    const m = this.map
    const N = m.N
    const night = this.tod === 'night'
    const glint = night ? '#6d86a8' : '#a9d0e0'
    const foam = night ? '#9fb0c4' : '#f4f8f4'
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * N + tx
        if (m.ter[i] !== Ter.Water) continue
        // glints that come and go
        for (let k = 0; k < 2; k++) {
          const ph = hash2(tx, ty, k + 7) * 6.283
          const s = Math.sin(t * 1.6 + ph)
          if (s < 0.82) continue
          const u = hash2(tx, ty, k + 11), v = hash2(ty, tx, k + 13)
          const wx = tx + u, wy = ty + v
          const sx = Math.round((wx - wy) * (TW / 2) - camX), sy = Math.round((wx + wy) * (TH / 2) - camY)
          ctx.fillStyle = glint
          ctx.fillRect(sx - (s > 0.94 ? 1 : 0), sy, s > 0.94 ? 3 : 2, 1)
        }
        // slow swell on open water
        if (m.depth[i] >= 3 && hash2(tx, ty, 3) < 0.35) {
          const ph = hash2(tx, ty, 5)
          const k = (t * 0.25 + ph) % 1
          const wx = tx + k, wy = ty + 0.5 - k * 0.3
          const sx = Math.round((wx - wy) * (TW / 2) - camX), sy = Math.round((wx + wy) * (TH / 2) - camY)
          ctx.globalAlpha = Math.sin(k * Math.PI) * 0.5
          ctx.fillStyle = glint
          ctx.fillRect(sx, sy, 4, 1)
          ctx.globalAlpha = 1
        }
        // the surf
        const f = this.foam[i]
        if (!f) continue
        ctx.fillStyle = foam
        for (let p = 0; p < f.length; p += 2) {
          const ph = hash2(i, p, 9) * 6.283
          const a = 0.5 + 0.5 * Math.sin(t * 1.9 + ph + (f[p] + f[p + 1]) * 0.02)
          if (a < 0.35) continue
          ctx.globalAlpha = a * 0.85
          ctx.fillRect(Math.round(f[p] - camX), Math.round(f[p + 1] - camY + (a > 0.8 ? 1 : 0)), 2, 1)
        }
        ctx.globalAlpha = 1
      }
  }

  /** shadows of clouds drifting with the wind */
  clouds(ctx: CanvasRenderingContext2D, camX: number, camY: number, W: number, H: number, t: number) {
    const S = 640, SH = 320
    const fx = t * 7 - camX, fy = t * 2.5 - camY
    const ox = (((fx % S) + S) % S) - S
    const oy = (((fy % SH) + SH) % SH) - SH
    ctx.imageSmoothingEnabled = true
    for (let y = oy; y < H; y += SH) for (let x = ox; x < W; x += S) ctx.drawImage(this.cloud, Math.round(x), Math.round(y), S, SH)
    ctx.imageSmoothingEnabled = false
  }

  /** the colour of the hour and of the weather, laid over everything that does not glow */
  grade(ctx: CanvasRenderingContext2D, W: number, H: number) {
    const tint = this.tod === 'night' ? (this.weather === 'rain' ? '#6070a0' : '#526294') : this.tod === 'dusk' ? '#f0b98c' : null
    if (tint) {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = tint
      ctx.fillRect(0, 0, W, H)
      if (this.tod === 'dusk') {
        ctx.fillStyle = '#efe4ee'
        ctx.fillRect(0, 0, W, H)
      }
    }
    if (this.weather === 'rain') {
      ctx.globalCompositeOperation = 'multiply'
      ctx.fillStyle = this.tod === 'night' ? '#c4ccd4' : '#a8b2ba'
      ctx.fillRect(0, 0, W, H)
    }
    ctx.globalCompositeOperation = 'source-over'
  }

  /** how strongly lights show at this hour */
  get lightLevel(): number {
    return this.tod === 'night' ? 1 : this.tod === 'dusk' ? 0.45 : this.weather === 'rain' ? 0.25 : 0
  }

  lights(ctx: CanvasRenderingContext2D, list: Light[], glow: (r: number, c: string) => HTMLCanvasElement) {
    ctx.globalCompositeOperation = 'lighter'
    for (const l of list) {
      if (l.a <= 0.01) continue
      ctx.globalAlpha = Math.min(1, l.a)
      const g = glow(l.r, l.color)
      ctx.drawImage(g, Math.round(l.x - l.r), Math.round(l.y - l.r))
    }
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** rain streaks, splashes and lightning */
  rain(ctx: CanvasRenderingContext2D, W: number, H: number, dt: number, rand: () => number) {
    if (this.weather !== 'rain') return
    const want = Math.round((W * H) / 900)
    while (this.drops.length < want) this.drops.push({ x: rand() * W, y: rand() * H, v: 160 + rand() * 90, l: 4 + Math.floor(rand() * 4) })
    if (this.drops.length > want) this.drops.length = want
    ctx.fillStyle = this.tod === 'night' ? 'rgba(150,170,200,0.45)' : 'rgba(210,225,240,0.55)'
    for (const d of this.drops) {
      d.y += d.v * dt
      d.x -= d.v * dt * 0.25
      if (d.y > H || d.x < 0) {
        // a splash where it lands, then back to the top
        ctx.fillRect(Math.round(d.x) - 1, Math.round(Math.min(d.y, H - 1)), 3, 1)
        d.y = -rand() * 20
        d.x = rand() * (W + 60)
      }
      for (let k = 0; k < d.l; k++) ctx.fillRect(Math.round(d.x + k * 0.25), Math.round(d.y - k), 1, 1)
    }
    // lightning
    this.nextBolt -= dt
    if (this.nextBolt <= 0) {
      this.nextBolt = 7 + rand() * 14
      this.flash = 1
    }
    if (this.flash > 0) {
      const k = this.flash > 0.7 || (this.flash > 0.3 && this.flash < 0.45) ? this.flash : this.flash * 0.3
      ctx.fillStyle = `rgba(230,235,255,${k * 0.45})`
      ctx.fillRect(0, 0, W, H)
      this.flash -= dt * 2.2
    }
  }

  /** a light film grain */
  filmGrain(ctx: CanvasRenderingContext2D, W: number, H: number, amount: number) {
    if (amount <= 0) return
    const g = this.grain[(this.gi = (this.gi + 1) % 4)]
    ctx.globalAlpha = Math.min(1, amount * 2.2)
    const ox = Math.floor(hash2(this.gi, 1, 3) * 96), oy = Math.floor(hash2(this.gi, 2, 3) * 96)
    for (let y = -oy; y < H; y += 96) for (let x = -ox; x < W; x += 96) ctx.drawImage(g, x, y)
    ctx.globalAlpha = 1
  }
}
