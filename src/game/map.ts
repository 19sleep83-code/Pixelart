// The battlefield: a patchwork of fields and meadows, woods, a river with bridges, country roads,
// villages with red roofs, and fields of ore to fight over. Generated from a seed.

import { mulberry32, fbm, hash2, type Rand } from '../core/rng'
import { ORE_PER_TILE } from './defs'

export const enum Ter {
  Grass = 0,
  Field = 1,
  Forest = 2,
  Water = 3,
  Road = 4,
  Ore = 5,
  Bridge = 6,
  Dirt = 7,
}

export type StaticKind = 'oak' | 'pine' | 'birch' | 'house' | 'timber' | 'church' | 'barn'
export interface Static {
  kind: StaticKind
  v: number
  x: number
  y: number
}

export class GameMap {
  ter: Uint8Array
  /** crop of a field (0-4) or shade of a meadow; bit 3: furrows run along y */
  variant: Uint8Array
  parcel: Int32Array
  ore: Int32Array
  /** trees, houses and water: nothing on the ground goes there */
  block: Uint8Array
  /** the building standing on a tile (entity id) */
  bld: Int32Array
  /** road links to the four neighbours: 1 +x, 2 -x, 4 +y, 8 -y */
  road: Uint8Array
  statics: Static[] = []
  tileStatics: (Static[] | undefined)[]
  starts: { x: number; y: number }[] = []
  constructor(public N: number, public seed: number) {
    const n = N * N
    this.ter = new Uint8Array(n)
    this.variant = new Uint8Array(n)
    this.parcel = new Int32Array(n)
    this.ore = new Int32Array(n)
    this.block = new Uint8Array(n)
    this.bld = new Int32Array(n)
    this.road = new Uint8Array(n)
    this.tileStatics = new Array(n)
  }
  inMap(x: number, y: number) {
    return x >= 0 && y >= 0 && x < this.N && y < this.N
  }
  idx(x: number, y: number) {
    return y * this.N + x
  }
  /** can a ground unit stand on this tile */
  walk(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= this.N || y >= this.N) return false
    const i = y * this.N + x
    return !this.block[i] && !this.bld[i]
  }
  walkI(i: number): boolean {
    return !this.block[i] && !this.bld[i]
  }
  buildable(x: number, y: number): boolean {
    if (!this.inMap(x, y)) return false
    const i = this.idx(x, y)
    const t = this.ter[i]
    return !this.block[i] && !this.bld[i] && (t === Ter.Grass || t === Ter.Field || t === Ter.Road || t === Ter.Dirt)
  }
  addStatic(s: Static) {
    const tx = Math.floor(s.x), ty = Math.floor(s.y)
    const i = this.idx(tx, ty)
    this.statics.push(s)
    ;(this.tileStatics[i] ??= []).push(s)
  }
}

// ─────────────────────────────────────────────────────────── generation

function splitParcels(m: GameMap, r: Rand) {
  let id = 1
  const rects: [number, number, number, number][] = [[0, 0, m.N, m.N]]
  while (rects.length) {
    const [x, y, w, h] = rects.pop()!
    const big = Math.max(w, h)
    if (big > 12 || (big > 6 && r() < 0.55)) {
      if (w >= h) {
        const s = Math.floor(w * (0.35 + r() * 0.3))
        rects.push([x, y, s, h], [x + s, y, w - s, h])
      } else {
        const s = Math.floor(h * (0.35 + r() * 0.3))
        rects.push([x, y, w, s], [x, y + s, w, h - s])
      }
      continue
    }
    const k = r()
    const along = r() < 0.5 ? 8 : 0
    for (let yy = y; yy < y + h; yy++)
      for (let xx = x; xx < x + w; xx++) {
        const i = m.idx(xx, yy)
        m.parcel[i] = id
        if (k < 0.1) {
          m.ter[i] = Ter.Forest
        } else if (k < 0.62) {
          m.ter[i] = Ter.Field
          m.variant[i] = (Math.floor(((k - 0.1) / 0.52) * 5) % 5) | along
        } else {
          m.ter[i] = Ter.Grass
          m.variant[i] = Math.floor(r() * 3)
        }
      }
    id++
  }
}

/** a road between two points, found on a cost map that prefers fields and old roads to woods and water */
function roadPath(m: GameMap, ax: number, ay: number, bx: number, by: number): number[] {
  const N = m.N
  const cost = (i: number) => {
    const t = m.ter[i]
    if (t === Ter.Road || t === Ter.Bridge) return 0.35
    if (t === Ter.Water) return 14
    if (t === Ter.Forest) return 3
    if (t === Ter.Ore) return 6
    if (m.block[i]) return 30
    return 1 + hash2(i, 3, m.seed) * 0.4
  }
  const g = new Float32Array(N * N).fill(1e9)
  const came = new Int32Array(N * N).fill(-1)
  const open: number[] = []
  const start = m.idx(ax, ay), goal = m.idx(bx, by)
  g[start] = 0
  open.push(start)
  const f = new Float32Array(N * N)
  f[start] = Math.abs(ax - bx) + Math.abs(ay - by)
  const closed = new Uint8Array(N * N)
  while (open.length) {
    let bi = 0
    for (let k = 1; k < open.length; k++) if (f[open[k]] < f[open[bi]]) bi = k
    const cur = open[bi]
    open[bi] = open[open.length - 1]
    open.pop()
    if (cur === goal) break
    if (closed[cur]) continue
    closed[cur] = 1
    const cx = cur % N, cy = (cur / N) | 0
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cx + dx, ny = cy + dy
      if (!m.inMap(nx, ny)) continue
      const ni = m.idx(nx, ny)
      // bridges cross the river straight
      const turn = came[cur] >= 0 && m.ter[cur] === Ter.Water && (cur - came[cur]) !== (ni - cur) ? 40 : 0
      const ng = g[cur] + cost(ni) + turn
      if (ng < g[ni]) {
        g[ni] = ng
        came[ni] = cur
        f[ni] = ng + (Math.abs(nx - bx) + Math.abs(ny - by)) * 0.4
        open.push(ni)
      }
    }
  }
  const path: number[] = []
  let c = goal
  while (c >= 0) {
    path.push(c)
    if (c === start) break
    c = came[c]
  }
  return path.reverse()
}

function layRoad(m: GameMap, path: number[]) {
  const N = m.N
  for (let k = 0; k < path.length; k++) {
    const i = path[k]
    m.ter[i] = m.ter[i] === Ter.Water || m.ter[i] === Ter.Bridge ? Ter.Bridge : Ter.Road
    m.block[i] = 0
    m.ore[i] = 0
    for (const j of [path[k - 1], path[k + 1]]) {
      if (j === undefined) continue
      const d = j - i
      m.road[i] |= d === 1 ? 1 : d === -1 ? 2 : d === N ? 4 : 8
    }
  }
}

function oreField(m: GameMap, cx: number, cy: number, rad: number, r: Rand) {
  for (let y = Math.floor(cy - rad - 2); y <= cy + rad + 2; y++)
    for (let x = Math.floor(cx - rad - 2); x <= cx + rad + 2; x++) {
      if (!m.inMap(x, y)) continue
      const d = Math.hypot(x - cx, y - cy) + (fbm(x, y, 3, m.seed + 77, 2) - 0.5) * 2.2
      const i = m.idx(x, y)
      if (d < rad && m.ter[i] !== Ter.Water && m.ter[i] !== Ter.Bridge && m.ter[i] !== Ter.Road) {
        m.ter[i] = Ter.Ore
        m.ore[i] = Math.round(ORE_PER_TILE * (0.55 + 0.45 * (1 - d / rad)) * (0.85 + r() * 0.3))
        m.block[i] = 0
      } else if (d < rad + 1.6 && m.ter[i] === Ter.Forest) {
        m.ter[i] = Ter.Grass
      }
    }
}

export function generateMap(seed: number, N = 96): GameMap {
  const m = new GameMap(N, seed)
  const r = mulberry32(seed)
  splitParcels(m, r)

  // woods: noise on top of the forest parcels
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = m.idx(x, y)
      const f = fbm(x, y, 16, seed + 5, 3)
      if (f > 0.63) m.ter[i] = Ter.Forest
      else if (m.ter[i] === Ter.Forest && f < 0.36) m.ter[i] = Ter.Grass
    }

  // the river runs from the top corner to the bottom corner, between the two armies
  const wob = r() * 1000
  for (let t = -0.02; t <= 1.02; t += 0.002) {
    const c = t * N
    const o = (fbm(t * 60 + wob, 0, 12, seed + 9, 3) - 0.5) * N * 0.55
    const cx = c + o * 0.7071, cy = c - o * 0.7071
    const w = 1.1 + fbm(t * 40, 5, 8, seed + 11, 2) * 1.1
    for (let y = Math.floor(cy - 3); y <= cy + 3; y++)
      for (let x = Math.floor(cx - 3); x <= cx + 3; x++) {
        if (!m.inMap(x, y)) continue
        if (Math.hypot(x + 0.5 - cx, y + 0.5 - cy) < w) m.ter[m.idx(x, y)] = Ter.Water
      }
  }
  // a pond or two
  for (let k = 0; k < 2; k++) {
    if (r() < 0.4) continue
    const side = k === 0 ? 1 : -1
    const px = N * 0.5 + side * N * (0.12 + r() * 0.1) + (r() - 0.5) * N * 0.4
    const py = N * 0.5 - side * N * (0.12 + r() * 0.1) + (r() - 0.5) * N * 0.4
    const rad = 2 + r() * 2.5
    for (let y = Math.floor(py - rad - 2); y <= py + rad + 2; y++)
      for (let x = Math.floor(px - rad - 2); x <= px + rad + 2; x++)
        if (m.inMap(x, y) && Math.hypot(x - px, y - py) + (fbm(x, y, 3, seed + 3, 2) - 0.5) * 2 < rad) m.ter[m.idx(x, y)] = Ter.Water
  }

  // the two bases: the west (left) corner and the east (right) corner
  m.starts = [
    { x: 12, y: N - 13 },
    { x: N - 13, y: 12 },
  ]
  for (const s of m.starts)
    for (let y = s.y - 11; y <= s.y + 11; y++)
      for (let x = s.x - 11; x <= s.x + 11; x++) {
        if (!m.inMap(x, y)) continue
        const d = Math.hypot(x - s.x, y - s.y)
        const i = m.idx(x, y)
        if (d < 10 && (m.ter[i] === Ter.Forest || m.ter[i] === Ter.Water)) {
          m.ter[i] = Ter.Grass
          m.variant[i] = 0
        }
      }

  for (let i = 0; i < N * N; i++) m.block[i] = m.ter[i] === Ter.Water || m.ter[i] === Ter.Forest ? 1 : 0

  // roads: two routes between the bases over different bridges, and one along each side
  const [A, B] = m.starts
  const riverAt = (t: number) => {
    const c = t * N
    const o = (fbm(t * 60 + wob, 0, 12, seed + 9, 3) - 0.5) * N * 0.55
    return { x: Math.round(c + o * 0.7071), y: Math.round(c - o * 0.7071) }
  }
  const crossings = [riverAt(0.3 + r() * 0.08), riverAt(0.62 + r() * 0.08)]
  for (const c of crossings) {
    const cx = Math.max(2, Math.min(N - 3, c.x)), cy = Math.max(2, Math.min(N - 3, c.y))
    layRoad(m, roadPath(m, A.x + 2, A.y - 2, cx, cy))
    layRoad(m, roadPath(m, cx, cy, B.x - 2, B.y + 2))
  }
  // villages along the roads, away from the bases
  const roadTiles: number[] = []
  for (let i = 0; i < N * N; i++) if (m.ter[i] === Ter.Road) roadTiles.push(i)
  const villages: { x: number; y: number }[] = []
  for (let tries = 0; tries < 400 && villages.length < 4; tries++) {
    const i = roadTiles[Math.floor(r() * roadTiles.length)]
    if (i === undefined) break
    const x = i % N, y = (i / N) | 0
    if (m.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 20)) continue
    if (villages.some((v) => Math.hypot(v.x - x, v.y - y) < 22)) continue
    villages.push({ x, y })
  }
  let church = false
  for (const v of villages) {
    let houses = 0
    const want = 5 + Math.floor(r() * 5)
    for (let tries = 0; tries < 80 && houses < want; tries++) {
      const x = v.x + Math.round((r() - 0.5) * 8), y = v.y + Math.round((r() - 0.5) * 8)
      if (!m.inMap(x, y) || x < 1 || y < 1 || x > N - 2 || y > N - 2) continue
      const i = m.idx(x, y)
      if (m.ter[i] === Ter.Road || m.ter[i] === Ter.Bridge || m.ter[i] === Ter.Water || m.ter[i] === Ter.Ore) continue
      if (m.tileStatics[i]) continue
      // next to a road or another house
      let near = false
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const j = m.idx(x + dx, y + dy)
          if (m.ter[j] === Ter.Road || m.tileStatics[j]?.some((s) => s.kind !== 'oak' && s.kind !== 'pine' && s.kind !== 'birch')) near = true
        }
      if (!near) continue
      const kind = !church ? 'church' : r() < 0.15 ? 'barn' : r() < 0.4 ? 'timber' : 'house'
      church = true
      m.ter[i] = Ter.Grass
      m.variant[i] = 2
      m.block[i] = 1
      m.addStatic({ kind, v: Math.floor(r() * 4), x: x + 0.5, y: y + 0.5 })
      houses++
    }
    // the village clears the wood round it
    for (let y = v.y - 6; y <= v.y + 6; y++)
      for (let x = v.x - 6; x <= v.x + 6; x++) {
        if (!m.inMap(x, y)) continue
        const i = m.idx(x, y)
        if (m.ter[i] === Ter.Forest && Math.hypot(x - v.x, y - v.y) < 5) {
          m.ter[i] = Ter.Grass
          m.block[i] = 0
        }
      }
  }

  // ore: two fields by each base and three to fight over
  const dirA = { x: 1, y: -1 }
  for (let k = 0; k < 2; k++) {
    const s = m.starts[k]
    const sgn = k === 0 ? 1 : -1
    oreField(m, s.x + sgn * 8 + (r() - 0.5) * 2, s.y + sgn * 1 + (r() - 0.5) * 2, 2.6, r)
    oreField(m, s.x + sgn * -1 + (r() - 0.5) * 2, s.y - sgn * 8 + (r() - 0.5) * 2, 2.6, r)
  }
  void dirA
  oreField(m, N * 0.5 + (r() - 0.5) * 6, N * 0.5 + (r() - 0.5) * 6, 3.4, r)
  oreField(m, N * 0.2 + r() * 6, N * 0.2 + r() * 6, 3.2, r)
  oreField(m, N * 0.8 - r() * 6, N * 0.8 - r() * 6, 3.2, r)
  // make sure the middle field is not drowned
  for (let i = 0; i < N * N; i++) if (m.ter[i] === Ter.Ore) m.block[i] = 0

  // trees in the woods, and a few on their own in the fields
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const i = m.idx(x, y)
      if (m.ter[i] === Ter.Forest) {
        const pines = fbm(x, y, 20, seed + 21, 2) > 0.5
        const n = 1 + (r() < 0.55 ? 1 : 0)
        for (let k = 0; k < n; k++) {
          const kind: StaticKind = pines ? (r() < 0.85 ? 'pine' : 'oak') : r() < 0.12 ? 'birch' : r() < 0.2 ? 'pine' : 'oak'
          m.addStatic({ kind, v: Math.floor(r() * 4), x: x + 0.2 + r() * 0.6, y: y + 0.2 + r() * 0.6 })
        }
      } else if ((m.ter[i] === Ter.Grass || m.ter[i] === Ter.Field) && !m.block[i] && !m.tileStatics[i]) {
        // lone trees along the edges of fields
        const edge = x > 0 && y > 0 && (m.parcel[i] !== m.parcel[i - 1] || m.parcel[i] !== m.parcel[i - N])
        if (r() < (edge ? 0.06 : 0.008) && !m.starts.some((s) => Math.hypot(s.x - x, s.y - y) < 11)) {
          m.addStatic({ kind: r() < 0.3 ? 'birch' : 'oak', v: Math.floor(r() * 4), x: x + 0.5, y: y + 0.5 })
          m.block[i] = 1
        }
      }
    }
  return m
}
