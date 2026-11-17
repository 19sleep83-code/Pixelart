// The ground, painted once into one big picture: fields with furrows, meadows, woodland floor,
// the river with its banks, roads and bridges, bare earth where the ore lies. Scorch marks and
// rubble are painted onto it later, so they stay.

import { GameMap, Ter } from './map'
import { hash2, valueNoise } from '../core/rng'
import { toABGR, shade, mix, hex, TW, TH } from '../core/iso'
import { makeCanvas, type Sprite } from '../core/voxel'
import type { Assets } from './assets'

const CROP: [number, number][] = [
  [hex('c4a64e'), hex('ad9040')], // wheat
  [hex('d3bf3a'), hex('b5a431')], // rapeseed
  [hex('789c42'), hex('668838')], // young crop
  [hex('7a5b3c'), hex('634930')], // ploughed
  [hex('b8a46c'), hex('a28f5a')], // stubble
]
const GRASS = [hex('5b893a'), hex('65913f'), hex('557f36')]
const HEDGE = hex('46702f')
const FOREST = hex('3a5a2b')
const DIRT = hex('7a674a')
const BANK = hex('6f6a4a')
const WATER_DEEP = hex('33607a')
const WATER = hex('3c6c86')
const WATER_SHALLOW = hex('4b7e92')
const ASPHALT = hex('686763')
const ROAD_EDGE = hex('8d8778')
const DECK = hex('8a8274')
const DECK_DARK = hex('6a6358')
const OUTSIDE = hex('141a12')
const SAND = hex('d0bf8b')
const WET_SAND = hex('ad9c6c')
const WATER_DEEPEST = hex('2a5270')

export class Terrain {
  cv: HTMLCanvasElement
  ctx: CanvasRenderingContext2D
  /** world pixel x of the canvas' left edge is -ox */
  ox: number
  mini: HTMLCanvasElement
  constructor(public map: GameMap) {
    const N = map.N
    this.ox = N * (TW / 2)
    this.cv = makeCanvas(N * TW, N * TH)
    this.ctx = this.cv.getContext('2d')!
    this.mini = makeCanvas(1, 1)
  }

  paint() {
    const m = this.map
    const N = m.N
    const W = this.cv.width, H = this.cv.height
    const img = this.ctx.createImageData(W, H)
    const px = new Uint32Array(img.data.buffer)
    const seed = m.seed
    // neighbour masks: which of the eight neighbours are water (for land) or land (for water)
    const nb = new Uint8Array(N * N)
    const isWater = (x: number, y: number) => {
      if (!m.inMap(x, y)) return false
      const t = m.ter[m.idx(x, y)]
      return t === Ter.Water || t === Ter.Bridge
    }
    const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]
    // water beside a beach has a sandy edge
    const sandy = new Uint8Array(N * N)
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++)
        for (const [dx, dy] of D8)
          if (m.inMap(x + dx, y + dy) && m.ter[m.idx(x + dx, y + dy)] === Ter.Sand) sandy[m.idx(x, y)] = 1
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const w = isWater(x, y)
        let k = 0
        for (let d = 0; d < 8; d++) {
          const nx = x + D8[d][0], ny = y + D8[d][1]
          if (!m.inMap(nx, ny)) continue
          if (isWater(nx, ny) !== w) k |= 1 << d
        }
        nb[m.idx(x, y)] = k
      }
    const edgeDist = (k: number, u: number, v: number) => {
      let d = 9
      if (k & 1) d = Math.min(d, 1 - u)
      if (k & 2) d = Math.min(d, u)
      if (k & 4) d = Math.min(d, 1 - v)
      if (k & 8) d = Math.min(d, v)
      if (k & 16) d = Math.min(d, Math.hypot(1 - u, 1 - v))
      if (k & 32) d = Math.min(d, Math.hypot(u, 1 - v))
      if (k & 64) d = Math.min(d, Math.hypot(1 - u, v))
      if (k & 128) d = Math.min(d, Math.hypot(u, v))
      return d
    }
    const roadBand = (k: number, u: number, v: number) => {
      // distance to the road's centre lines inside this tile
      let d = Math.hypot(u - 0.5, v - 0.5)
      if (k & 1 && u >= 0.5) d = Math.min(d, Math.abs(v - 0.5))
      if (k & 2 && u <= 0.5) d = Math.min(d, Math.abs(v - 0.5))
      if (k & 4 && v >= 0.5) d = Math.min(d, Math.abs(u - 0.5))
      if (k & 8 && v <= 0.5) d = Math.min(d, Math.abs(u - 0.5))
      return d
    }
    const outside = toABGR(OUTSIDE)

    for (let py = 0; py < H; py++) {
      for (let pxx = 0; pxx < W; pxx++) {
        const sx = pxx - this.ox + 0.5
        const sy = py + 0.5
        const a = sx / (TW / 2), b = sy / (TH / 2)
        const wx = (a + b) / 2, wy = (b - a) / 2
        if (wx < 0 || wy < 0 || wx >= N || wy >= N) {
          px[py * W + pxx] = outside
          continue
        }
        const tx = wx | 0, ty = wy | 0
        const i = ty * N + tx
        const u = wx - tx, v = wy - ty
        const vx = (wx * 16) | 0, vy = (wy * 16) | 0 // the voxel grid on the ground
        const h = hash2(vx, vy, seed)
        const t = m.ter[i]
        let c: number
        if (t === Ter.Water || t === Ter.Bridge) {
          const d = edgeDist(nb[i], u, v)
          const dep = m.depth[i]
          if (d < 0.1) c = sandy[i] ? WET_SAND : BANK
          else if (d < 0.32) c = WATER_SHALLOW
          else if (dep >= 6) c = valueNoise(wx, wy, 4, seed + 4) > 0.5 ? WATER_DEEPEST : shade(WATER_DEEPEST, 1.06)
          else if (dep >= 3) c = valueNoise(wx, wy, 3, seed + 4) > 0.45 ? WATER_DEEP : WATER
          else c = valueNoise(wx, wy, 3, seed + 4) > 0.55 ? WATER_DEEP : WATER
          // ripples
          if (d >= 0.1 && ((vx + vy * 3) % 11 === 0) && h < 0.4) c = shade(c, 1.18)
          if (t === Ter.Bridge) {
            const rb = roadBand(m.road[i], u, v)
            if (rb < 0.3) {
              const along = m.road[i] & 3 ? vx : vy
              c = rb > 0.25 ? DECK_DARK : along % 3 === 0 ? shade(DECK, 0.92) : DECK
            }
          }
        } else {
          switch (t) {
            case Ter.Field: {
              const [base, furrow] = CROP[m.variant[i] & 7] ?? CROP[0]
              const along = m.variant[i] & 8 ? vx : vy
              c = along % 3 === 0 ? furrow : base
              if ((m.variant[i] & 7) === 1 && h < 0.08) c = hex('8aa040')
              break
            }
            case Ter.Sand:
              c = h < 0.15 ? shade(SAND, 0.92) : h > 0.93 ? shade(SAND, 1.07) : SAND
              if (h > 0.995) c = hex('f2ecd8') // shells
              break
            case Ter.Forest:
              c = h < 0.3 ? shade(FOREST, 0.86) : FOREST
              break
            case Ter.Ore:
            case Ter.Dirt:
              c = h < 0.2 ? shade(DIRT, 0.88) : h > 0.9 ? shade(DIRT, 1.12) : DIRT
              if (t === Ter.Ore && h > 0.97) c = hex('c99a3a')
              break
            default: {
              c = GRASS[m.variant[i] % 3]
              const n = valueNoise(wx, wy, 5, seed + 1)
              if (n > 0.66) c = shade(c, 1.05)
              else if (n < 0.33) c = shade(c, 0.95)
              if (h < 0.05) c = shade(c, 1.15)
              else if (h > 0.985) c = h > 0.993 ? hex('e8e4d0') : hex('e0c84a') // flowers
            }
          }
          // hedges and paths where one parcel meets another
          if (t === Ter.Field || t === Ter.Grass) {
            const p = m.parcel[i]
            if ((u < 0.07 && tx > 0 && m.parcel[i - 1] !== p) || (v < 0.07 && ty > 0 && m.parcel[i - N] !== p)) c = HEDGE
          }
          // banks along the water
          if (nb[i]) {
            const d = edgeDist(nb[i], u, v)
            const bank = t === Ter.Sand ? WET_SAND : BANK
            if (d < 0.08) c = bank
            else if (d < 0.14) c = mix(c, bank, 0.5)
          }
          if (t === Ter.Road) {
            const rb = roadBand(m.road[i], u, v)
            if (rb < 0.27) c = h < 0.12 ? shade(ASPHALT, 0.94) : ASPHALT
            else if (rb < 0.33) c = ROAD_EDGE
          }
          // a little grain everywhere
          if (h > 0.5 && h < 0.56) c = shade(c, 0.96)
        }
        px[py * W + pxx] = toABGR(c)
      }
    }
    this.ctx.putImageData(img, 0, 0)
  }

  /** the shadows of trees and houses, which never move */
  bakeStatics(A: Assets) {
    const m = this.map
    for (const s of m.statics) {
      const arr = A.statics[s.kind]
      const art = arr[s.v % arr.length]
      const sx = (s.x - s.y) * (TW / 2) + this.ox
      const sy = (s.x + s.y) * (TH / 2)
      this.ctx.drawImage(art.sh.cv, Math.round(sx - art.sh.ax), Math.round(sy - art.sh.ay))
    }
  }

  /** paint a mark onto the ground at a world position (tiles) */
  stamp(sp: Sprite, x: number, y: number) {
    const sx = (x - y) * (TW / 2) + this.ox
    const sy = (x + y) * (TH / 2)
    this.ctx.drawImage(sp.cv, Math.round(sx - sp.ax), Math.round(sy - sp.ay))
    this.miniDirty = true
  }

  /** repaint one tile (ore used up) */
  repaintTile(tx: number, ty: number) {
    const m = this.map
    const i = m.idx(tx, ty)
    const sx = (tx - ty) * (TW / 2) + this.ox
    const sy = (tx + ty) * (TH / 2)
    const ctx = this.ctx
    ctx.save()
    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(sx + TW / 2, sy + TH / 2)
    ctx.lineTo(sx, sy + TH)
    ctx.lineTo(sx - TW / 2, sy + TH / 2)
    ctx.closePath()
    ctx.clip()
    for (let y = Math.floor(sy); y < sy + TH; y++)
      for (let x = Math.floor(sx - TW / 2); x < sx + TW / 2; x++) {
        const h = hash2(x, y, m.seed)
        ctx.fillStyle = '#' + (h < 0.2 ? shade(DIRT, 0.88) : h > 0.9 ? shade(DIRT, 1.12) : DIRT).toString(16).padStart(6, '0')
        ctx.fillRect(x, y, 1, 1)
      }
    ctx.restore()
    void i
    this.miniDirty = true
  }

  miniDirty = true
  /** the minimap's picture of the ground */
  miniMap(w: number, h: number): HTMLCanvasElement {
    if (!this.miniDirty && this.mini.width === w && this.mini.height === h) return this.mini
    this.mini.width = w
    this.mini.height = h
    const c = this.mini.getContext('2d')!
    c.imageSmoothingEnabled = true
    c.imageSmoothingQuality = 'high'
    c.drawImage(this.cv, 0, 0, w, h)
    // the woods read better as dark patches than as their floor
    const m = this.map
    const N = m.N
    const sx = w / this.cv.width, sy = h / this.cv.height
    c.fillStyle = '#2c4a26'
    for (const s of m.statics) {
      if (s.kind !== 'oak' && s.kind !== 'pine' && s.kind !== 'birch') {
        c.fillStyle = '#a9452e'
        c.fillRect(((s.x - s.y) * 16 + this.ox) * sx - 1, (s.x + s.y) * 8 * sy - 1, 2, 2)
        c.fillStyle = '#2c4a26'
        continue
      }
      c.fillRect(((s.x - s.y) * 16 + this.ox) * sx - 0.5, (s.x + s.y) * 8 * sy - 0.5, 1.4, 1.2)
    }
    void N
    this.miniDirty = false
    return this.mini
  }
}
