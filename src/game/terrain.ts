// The ground: fields with furrows, meadows with grass and flowers, woodland floor, the river with
// its banks, beaches, roads and bridges, bare earth where the ore lies.
//
// At this resolution the whole map would be one picture of 6144 × 3072 pixels, far too big to
// keep. So the ground is painted in square pieces as they come into view and kept in a cache;
// the pieces round the camera are painted ahead in spare moments. Scorch marks and rubble are
// remembered and painted into every piece they touch, so they stay.

import { GameMap, Ter } from './map'
import { hash2, valueNoise } from '../core/rng'
import { toABGR, shade, mix, hex, TW, TH, css } from '../core/iso'
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
const HEDGE_DARK = hex('3a5e28')
const FOREST = hex('3a5a2b')
const DIRT = hex('7a674a')
const BANK = hex('6f6a4a')
const WATER_DEEP = hex('33607a')
const WATER = hex('3c6c86')
const WATER_SHALLOW = hex('4b7e92')
const ASPHALT = hex('686763')
const ROAD_EDGE = hex('8d8778')
const ROAD_LINE = hex('cfcab8')
const DECK = hex('8a8274')
const DECK_DARK = hex('6a6358')
const OUTSIDE = hex('141a12')
const SAND = hex('d0bf8b')
const WET_SAND = hex('ad9c6c')
const WATER_DEEPEST = hex('2a5270')

/** the size of a cached piece of ground, in pixels */
const CH = 256
/** how many pieces are kept at most */
const KEEP = 180

const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]

function edgeDist(k: number, u: number, v: number) {
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

/** distance to the road's centre lines inside a tile */
function roadBand(k: number, u: number, v: number) {
  let d = Math.hypot(u - 0.5, v - 0.5)
  if (k & 1 && u >= 0.5) d = Math.min(d, Math.abs(v - 0.5))
  if (k & 2 && u <= 0.5) d = Math.min(d, Math.abs(v - 0.5))
  if (k & 4 && v >= 0.5) d = Math.min(d, Math.abs(u - 0.5))
  if (k & 8 && v <= 0.5) d = Math.min(d, Math.abs(u - 0.5))
  return d
}

interface Mark {
  sp: Sprite
  /** where the sprite's anchor lands, in terrain pixels */
  px: number
  py: number
}

export class Terrain {
  /** the size of the whole ground picture */
  width: number
  height: number
  /** world pixel x of the picture's left edge is -ox */
  ox: number
  mini: HTMLCanvasElement
  miniDirty = true
  private nb: Uint8Array
  private sandy: Uint8Array
  private chunks = new Map<number, HTMLCanvasElement>()
  private marks: Mark[] = []
  private A: Assets | null = null
  private cols: number
  private rows: number
  /** without the large soft patches of colour (for tiles that must fit any neighbour) */
  flat = false

  constructor(public map: GameMap) {
    const N = map.N
    this.ox = N * (TW / 2)
    this.width = N * TW
    this.height = N * TH
    this.cols = Math.ceil(this.width / CH)
    this.rows = Math.ceil(this.height / CH)
    this.mini = makeCanvas(1, 1)
    this.nb = new Uint8Array(N * N)
    this.sandy = new Uint8Array(N * N)
  }

  /** work out the shore lines once; the pixels are painted later, piece by piece */
  paint() {
    const m = this.map
    const N = m.N
    const isWater = (x: number, y: number) => {
      if (!m.inMap(x, y)) return false
      const t = m.ter[m.idx(x, y)]
      return t === Ter.Water || t === Ter.Bridge
    }
    for (let y = 0; y < N; y++)
      for (let x = 0; x < N; x++) {
        const i = m.idx(x, y)
        const w = isWater(x, y)
        let k = 0
        for (let d = 0; d < 8; d++) {
          const nx = x + D8[d][0], ny = y + D8[d][1]
          if (!m.inMap(nx, ny)) continue
          if (isWater(nx, ny) !== w) k |= 1 << d
          if (m.ter[m.idx(nx, ny)] === Ter.Sand) this.sandy[i] = 1
        }
        this.nb[i] = k
      }
  }

  /** the shadows of trees and houses are painted into each piece */
  bakeStatics(A: Assets) {
    this.A = A
  }

  /** the colour of the ground at a point (world tiles) */
  colorAt(wx: number, wy: number): number {
    const m = this.map
    const N = m.N
    if (wx < 0 || wy < 0 || wx >= N || wy >= N) return OUTSIDE
    const seed = m.seed
    const tx = wx | 0, ty = wy | 0
    const i = ty * N + tx
    const u = wx - tx, v = wy - ty
    const vx = (wx * 32) | 0, vy = (wy * 32) | 0 // the fine grid on the ground
    const h = hash2(vx, vy, seed)
    const t = m.ter[i]
    const nb = this.nb[i]
    const vn = (x: number, y: number, cell: number, s: number) => (this.flat ? 0.5 : valueNoise(x, y, cell, s))
    let c: number
    if (t === Ter.Water || t === Ter.Bridge) {
      const d = edgeDist(nb, u, v)
      const dep = m.depth[i]
      if (d < 0.08) c = this.sandy[i] ? WET_SAND : BANK
      else if (d < 0.14) c = mix(this.sandy[i] ? WET_SAND : BANK, WATER_SHALLOW, 0.5)
      else if (d < 0.32) c = WATER_SHALLOW
      else if (dep >= 6) c = vn(wx, wy, 4, seed + 4) > 0.5 ? WATER_DEEPEST : shade(WATER_DEEPEST, 1.06)
      else if (dep >= 3) c = vn(wx, wy, 3, seed + 4) > 0.45 ? WATER_DEEP : WATER
      else c = vn(wx, wy, 3, seed + 4) > 0.55 ? WATER_DEEP : WATER
      // ripples
      if (d >= 0.14 && (vx + vy * 3) % 19 === 0 && h < 0.4) c = shade(c, 1.15)
      if (t === Ter.Bridge) {
        const rb = roadBand(m.road[i], u, v)
        if (rb < 0.31) {
          const along = m.road[i] & 3 ? vx : vy
          c = rb > 0.27 ? DECK_DARK : rb > 0.25 ? hex('b0a898') : along % 4 === 0 ? shade(DECK, 0.9) : DECK
        }
      }
      return c
    }
    switch (t) {
      case Ter.Field: {
        const [base, furrow] = CROP[m.variant[i] & 7] ?? CROP[0]
        const along = m.variant[i] & 8 ? vx : vy
        const k = along % 4
        c = k === 0 ? furrow : k === 1 ? mix(base, furrow, 0.4) : base
        if ((m.variant[i] & 7) === 1 && h < 0.07) c = hex('8aa040')
        else if ((m.variant[i] & 7) === 0 && h > 0.97) c = hex('e0cc78')
        break
      }
      case Ter.Sand:
        c = h < 0.15 ? shade(SAND, 0.92) : h > 0.93 ? shade(SAND, 1.07) : SAND
        if (h > 0.997) c = hex('f2ecd8') // shells
        break
      case Ter.Forest:
        c = h < 0.3 ? shade(FOREST, 0.86) : h > 0.94 ? hex('5a4a2e') : FOREST // needles and twigs
        break
      case Ter.Ore:
      case Ter.Dirt:
        c = h < 0.2 ? shade(DIRT, 0.88) : h > 0.9 ? shade(DIRT, 1.12) : DIRT
        if (t === Ter.Ore && h > 0.975) c = hex('c99a3a')
        break
      default: {
        c = GRASS[m.variant[i] % 3]
        const n = vn(wx, wy, 5, seed + 1)
        if (n > 0.66) c = shade(c, 1.05)
        else if (n < 0.33) c = shade(c, 0.95)
        // blades of grass: short darker and lighter strokes
        const g = hash2(vx >> 1, vy, seed + 3)
        if (g < 0.08) c = shade(c, 0.86)
        else if (h < 0.05) c = shade(c, 1.14)
        else if (h > 0.988) c = h > 0.994 ? hex('ece8d6') : hex('e4cc4c') // flowers
      }
    }
    // hedges where one parcel meets another
    if (t === Ter.Field || t === Ter.Grass) {
      const p = m.parcel[i]
      const hedge = (u < 0.07 && tx > 0 && m.parcel[i - 1] !== p) || (v < 0.07 && ty > 0 && m.parcel[i - N] !== p)
      if (hedge) c = h < 0.35 ? HEDGE_DARK : HEDGE
    }
    // banks along the water
    if (nb) {
      const d = edgeDist(nb, u, v)
      const bank = t === Ter.Sand ? WET_SAND : BANK
      if (d < 0.07) c = bank
      else if (d < 0.13) c = mix(c, bank, 0.5)
    }
    if (t === Ter.Road) {
      const rb = roadBand(m.road[i], u, v)
      if (rb < 0.27) {
        c = h < 0.12 ? shade(ASPHALT, 0.94) : h > 0.96 ? shade(ASPHALT, 1.08) : ASPHALT
        // a dashed centre line
        const along = m.road[i] & 3 ? vx : vy
        if (rb < 0.012 && along % 12 < 6) c = ROAD_LINE
      } else if (rb < 0.31) c = ROAD_EDGE
      else if (rb < 0.33) c = shade(ROAD_EDGE, 0.85)
    }
    // a little grain everywhere
    if (h > 0.5 && h < 0.55) c = shade(c, 0.96)
    return c
  }

  private paintChunk(cx: number, cy: number): HTMLCanvasElement {
    const cv = makeCanvas(CH, CH)
    const ctx = cv.getContext('2d')!
    const img = ctx.createImageData(CH, CH)
    const px = new Uint32Array(img.data.buffer)
    const x0 = cx * CH, y0 = cy * CH
    for (let y = 0; y < CH; y++) {
      const sy = y0 + y + 0.5
      const b = sy / (TH / 2)
      for (let x = 0; x < CH; x++) {
        const sx = x0 + x - this.ox + 0.5
        const a = sx / (TW / 2)
        px[y * CH + x] = toABGR(this.colorAt((a + b) / 2, (b - a) / 2))
      }
    }
    ctx.putImageData(img, 0, 0)
    // the shadows of trees and houses near this piece
    const A = this.A
    if (A) {
      const m = this.map
      const pad = 3
      const c0 = this.toTile(x0 - 80, y0 - 80), c1 = this.toTile(x0 + CH + 80, y0 - 80)
      const c2 = this.toTile(x0 - 80, y0 + CH + 80), c3 = this.toTile(x0 + CH + 80, y0 + CH + 80)
      const tx0 = Math.max(0, Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)) - pad), tx1 = Math.min(m.N - 1, Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)) + pad)
      const ty0 = Math.max(0, Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)) - pad), ty1 = Math.min(m.N - 1, Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)) + pad)
      for (let ty = ty0; ty <= ty1; ty++)
        for (let tx = tx0; tx <= tx1; tx++) {
          const st = m.tileStatics[m.idx(tx, ty)]
          if (!st) continue
          for (const s of st) {
            const arr = A.statics[s.kind]
            const art = arr[s.v % arr.length]
            const sx = (s.x - s.y) * (TW / 2) + this.ox - x0
            const sy = (s.x + s.y) * (TH / 2) - y0
            ctx.drawImage(art.sh.cv, Math.round(sx - art.sh.ax), Math.round(sy - art.sh.ay))
          }
        }
    }
    // marks left by the fighting
    for (const mk of this.marks) {
      if (mk.px + mk.sp.w < x0 || mk.px - mk.sp.w > x0 + CH || mk.py + mk.sp.h < y0 || mk.py - mk.sp.h > y0 + CH) continue
      ctx.drawImage(mk.sp.cv, Math.round(mk.px - mk.sp.ax - x0), Math.round(mk.py - mk.sp.ay - y0))
    }
    return cv
  }

  private toTile(px: number, py: number) {
    const a = (px - this.ox) / (TW / 2), b = py / (TH / 2)
    return { x: (a + b) / 2, y: (b - a) / 2 }
  }

  private get(cx: number, cy: number): HTMLCanvasElement {
    const key = cy * this.cols + cx
    let c = this.chunks.get(key)
    if (c) {
      // most recently used goes to the back
      this.chunks.delete(key)
      this.chunks.set(key, c)
      return c
    }
    c = this.paintChunk(cx, cy)
    this.chunks.set(key, c)
    if (this.chunks.size > KEEP) this.chunks.delete(this.chunks.keys().next().value!)
    return c
  }

  /** draw the ground under the camera */
  draw(ctx: CanvasRenderingContext2D, camX: number, camY: number, W: number, H: number) {
    const x0 = camX + this.ox, y0 = camY
    const cx0 = Math.max(0, Math.floor(x0 / CH)), cx1 = Math.min(this.cols - 1, Math.floor((x0 + W) / CH))
    const cy0 = Math.max(0, Math.floor(y0 / CH)), cy1 = Math.min(this.rows - 1, Math.floor((y0 + H) / CH))
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) ctx.drawImage(this.get(cx, cy), Math.round(cx * CH - x0), Math.round(cy * CH - y0))
  }

  /** in spare moments, paint the pieces just outside the view so scrolling stays smooth */
  prefetch(camX: number, camY: number, W: number, H: number, budgetMs = 4) {
    const t0 = performance.now()
    const x0 = camX + this.ox, y0 = camY
    const cx0 = Math.max(0, Math.floor((x0 - CH * 2) / CH)), cx1 = Math.min(this.cols - 1, Math.floor((x0 + W + CH * 2) / CH))
    const cy0 = Math.max(0, Math.floor((y0 - CH * 2) / CH)), cy1 = Math.min(this.rows - 1, Math.floor((y0 + H + CH * 2) / CH))
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        if (this.chunks.has(cy * this.cols + cx)) continue
        this.get(cx, cy)
        if (performance.now() - t0 > budgetMs) return
      }
  }

  /** paint a mark onto the ground at a world position (tiles); it stays */
  stamp(sp: Sprite, x: number, y: number) {
    const mk = { sp, px: (x - y) * (TW / 2) + this.ox, py: (x + y) * (TH / 2) }
    this.marks.push(mk)
    if (this.marks.length > 1500) this.marks.splice(0, 300)
    for (const [key, cv] of this.chunks) {
      const cx = key % this.cols, cy = Math.floor(key / this.cols)
      const x0 = cx * CH, y0 = cy * CH
      if (mk.px + sp.w < x0 || mk.px - sp.w > x0 + CH || mk.py + sp.h < y0 || mk.py - sp.h > y0 + CH) continue
      cv.getContext('2d')!.drawImage(sp.cv, Math.round(mk.px - sp.ax - x0), Math.round(mk.py - sp.ay - y0))
    }
  }

  /** a tile changed (ore used up): the pieces it is on are painted again */
  repaintTile(tx: number, ty: number) {
    const sx = (tx - ty) * (TW / 2) + this.ox
    const sy = (tx + ty) * (TH / 2)
    for (const [kx, ky] of [[sx - TW / 2, sy], [sx + TW / 2, sy + TH], [sx, sy + TH], [sx, sy]]) {
      const cx = Math.floor(kx / CH), cy = Math.floor(ky / CH)
      this.chunks.delete(cy * this.cols + cx)
    }
    this.miniDirty = true
  }

  /** the minimap's picture of the ground: one dot of colour per tile */
  miniMap(w: number, h: number): HTMLCanvasElement {
    if (!this.miniDirty && this.mini.width === w && this.mini.height === h) return this.mini
    this.mini.width = w
    this.mini.height = h
    const c = this.mini.getContext('2d')!
    const m = this.map
    const N = m.N
    const kx = w / this.width, ky = h / this.height
    c.fillStyle = css(OUTSIDE)
    c.fillRect(0, 0, w, h)
    for (let ty = 0; ty < N; ty++)
      for (let tx = 0; tx < N; tx++) {
        const col = this.colorAt(tx + 0.5, ty + 0.5)
        const x = ((tx - ty) * (TW / 2) + this.ox) * kx, y = (tx + ty) * (TH / 2) * ky
        c.fillStyle = css(col)
        c.beginPath()
        c.moveTo(x, y)
        c.lineTo(x + (TW / 2) * kx, y + (TH / 2) * ky)
        c.lineTo(x, y + TH * ky)
        c.lineTo(x - (TW / 2) * kx, y + (TH / 2) * ky)
        c.closePath()
        c.fill()
      }
    // the woods read better as dark patches, the villages as red roofs
    for (const s of m.statics) {
      const x = ((s.x - s.y) * (TW / 2) + this.ox) * kx, y = (s.x + s.y) * (TH / 2) * ky
      const tree = s.kind === 'oak' || s.kind === 'pine' || s.kind === 'birch'
      c.fillStyle = tree ? '#2c4a26' : '#a9452e'
      c.fillRect(x - 0.7, y - 0.6, tree ? 1.4 : 2, tree ? 1.2 : 2)
    }
    this.miniDirty = false
    return this.mini
  }
}
