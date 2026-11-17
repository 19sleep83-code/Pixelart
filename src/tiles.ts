// The ground as a tile set for another engine: every kind of ground, painted by the game's own
// terrain painter, one isometric diamond (64 × 32) per tile. Shores come in all 47 shapes a tile
// can have between land and water, roads in all 16 ways of joining, fields and meadows with or
// without a hedge along their -x / -y side.
//
// Each tile is painted on a tiny map of 5 × 5 tiles whose middle tile is set up as wanted.

import { GameMap, Ter } from './game/map'
import { Terrain } from './game/terrain'
import { toABGR, TW, TH } from './core/iso'

export interface TileInfo {
  key: string
  col: number
  row: number
  kind: string
  [k: string]: unknown
}

/** neighbour bits: +x, -x, +y, -y, then the corners (+x+y), (-x+y), (+x-y), (-x-y) */
export const D8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]

/** a corner only counts while neither of the two sides beside it does */
export function canonMask(k: number): number {
  if (k & (1 | 4)) k &= ~16
  if (k & (2 | 4)) k &= ~32
  if (k & (1 | 8)) k &= ~64
  if (k & (2 | 8)) k &= ~128
  return k
}

export function shoreMasks(): number[] {
  const set = new Set<number>()
  for (let k = 1; k < 256; k++) set.add(canonMask(k))
  return [...set].sort((a, b) => a - b)
}

interface Setup {
  ter: number
  variant?: number
  /** neighbours that are of another ground, by bit; and what they are */
  other?: number
  otherTer?: number
  sameTer?: number
  hedge?: number
  road?: number
  depth?: number
  seed: number
  /** keep only what differs from this ground (an overlay with a clear background) */
  over?: Setup
}

const N = 5, C = 2

function paintTile(s: Setup): Uint32Array {
  const m = new GameMap(N, s.seed)
  const same = s.sameTer ?? s.ter
  m.ter.fill(same)
  m.variant.fill(s.variant ?? 0)
  m.depth.fill(s.ter === Ter.Water || s.ter === Ter.Bridge ? s.depth ?? 1 : 0)
  m.parcel.fill(1)
  const ci = m.idx(C, C)
  m.ter[ci] = s.ter
  for (let d = 0; d < 8; d++) if ((s.other ?? 0) & (1 << d)) m.ter[m.idx(C + D8[d][0], C + D8[d][1])] = s.otherTer!
  if ((s.hedge ?? 0) & 1) m.parcel[m.idx(C - 1, C)] = 2
  if ((s.hedge ?? 0) & 2) m.parcel[m.idx(C, C - 1)] = 2
  if (s.road !== undefined) m.road[ci] = s.road
  const t = new Terrain(m)
  t.flat = true
  t.paint()
  const px = new Uint32Array(TW * TH)
  for (let y = 0; y < TH; y++)
    for (let x = 0; x < TW; x++) {
      // the same sampling as the game: the middle of each screen pixel
      const a = (x + 0.5 - TW / 2) / (TW / 2), b = (y + 0.5) / (TH / 2)
      const u = (a + b) / 2, v = (b - a) / 2
      if (u < 0 || u >= 1 || v < 0 || v >= 1) continue
      px[y * TW + x] = toABGR(t.colorAt(C + u, C + v))
    }
  return px
}

export function buildTiles(): { atlas: HTMLCanvasElement; tiles: TileInfo[]; cols: number } {
  const list: { info: Omit<TileInfo, 'col' | 'row'>; setup: Setup }[] = []
  const add = (info: Omit<TileInfo, 'col' | 'row'>, setup: Setup) => list.push({ info, setup })
  const V = 4
  // meadows: three shades, hedges on none / -x / -y / both sides
  for (let sh = 0; sh < 3; sh++)
    for (let h = 0; h < 4; h++)
      for (let k = 0; k < V; k++) add({ key: `grass/s${sh}/h${h}/v${k}`, kind: 'grass', shade: sh, hedge: h, v: k }, { ter: Ter.Grass, variant: sh, hedge: h, seed: 100 + k * 17 + sh * 3 + h * 5 })
  // fields: five crops, furrows along y (d0) or x (d1), hedges
  const CROPS = ['wheat', 'rapeseed', 'young', 'ploughed', 'stubble']
  for (let c = 0; c < 5; c++)
    for (let d = 0; d < 2; d++)
      for (let h = 0; h < 4; h++)
        for (let k = 0; k < 2; k++)
          add({ key: `field/c${c}/d${d}/h${h}/v${k}`, kind: 'field', crop: CROPS[c], furrowsAlongX: d === 1, hedge: h, v: k }, { ter: Ter.Field, variant: c | (d ? 8 : 0), hedge: h, seed: 300 + k * 13 + c * 7 + h })
  for (const [name, ter] of [['forest', Ter.Forest], ['dirt', Ter.Dirt], ['ore', Ter.Ore], ['sand', Ter.Sand]] as [string, number][])
    for (let k = 0; k < V; k++) add({ key: `${name}/v${k}`, kind: name, v: k }, { ter, seed: 500 + k * 11 + ter * 3 })
  // open water by depth: 1 near the shore, 3 open, 6 deep
  for (const dep of [1, 3, 6])
    for (let k = 0; k < V; k++) add({ key: `water/d${dep}/v${k}`, kind: 'water', depth: dep, v: k }, { ter: Ter.Water, depth: dep, seed: 700 + k * 19 + dep })
  // shores: the water side (bank or sand beach) and the land side
  for (const m of shoreMasks()) {
    add({ key: `shore/water-grass/m${m}`, kind: 'shore', side: 'water', land: 'grass', mask: m }, { ter: Ter.Water, other: m, otherTer: Ter.Grass, depth: 1, seed: 900 + m })
    add({ key: `shore/water-sand/m${m}`, kind: 'shore', side: 'water', land: 'sand', mask: m }, { ter: Ter.Water, other: m, otherTer: Ter.Sand, depth: 1, seed: 1200 + m })
    add({ key: `shore/grass/m${m}`, kind: 'shore', side: 'land', land: 'grass', mask: m }, { ter: Ter.Grass, other: m, otherTer: Ter.Water, seed: 1500 + m })
    add({ key: `shore/sand/m${m}`, kind: 'shore', side: 'land', land: 'sand', mask: m }, { ter: Ter.Sand, other: m, otherTer: Ter.Water, seed: 1800 + m })
  }
  // roads as overlays for a second layer, joined to +x (1), -x (2), +y (4), -y (8)
  for (let r = 0; r < 16; r++)
    for (let k = 0; k < 2; k++) {
      const seed = 2100 + r * 3 + k * 31
      add({ key: `road/r${r}/v${k}`, kind: 'road', overlay: true, joins: r, v: k }, { ter: Ter.Road, road: r, seed, over: { ter: Ter.Grass, seed } })
    }
  // bridges over open water, along x or along y
  for (const r of [3, 12]) add({ key: `bridge/r${r}`, kind: 'bridge', joins: r }, { ter: Ter.Bridge, road: r, depth: 3, seed: 2400 + r })

  const cols = 16
  const rows = Math.ceil(list.length / cols)
  const atlas = document.createElement('canvas')
  atlas.width = cols * TW
  atlas.height = rows * TH
  const ctx = atlas.getContext('2d')!
  const tiles: TileInfo[] = []
  list.forEach((it, i) => {
    const col = i % cols, row = Math.floor(i / cols)
    const img = ctx.createImageData(TW, TH)
    const px = paintTile(it.setup)
    if (it.setup.over) {
      const base = paintTile(it.setup.over)
      for (let p = 0; p < px.length; p++) if (px[p] === base[p]) px[p] = 0
    }
    new Uint32Array(img.data.buffer).set(px)
    ctx.putImageData(img, col * TW, row * TH)
    tiles.push({ ...it.info, col, row } as TileInfo)
  })
  return { atlas, tiles, cols }
}
