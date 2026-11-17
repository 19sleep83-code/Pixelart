// Path finding on the tile grid: A* over eight directions without cutting corners, then the
// path is pulled tight so units drive in straight lines wherever the ground allows.

import type { GameMap } from './map'
import { Ter } from './map'

class Heap {
  items: number[] = []
  keys: number[] = []
  push(i: number, k: number) {
    const it = this.items, ks = this.keys
    let n = it.length
    it.push(i)
    ks.push(k)
    while (n > 0) {
      const p = (n - 1) >> 1
      if (ks[p] <= k) break
      it[n] = it[p]
      ks[n] = ks[p]
      n = p
    }
    it[n] = i
    ks[n] = k
  }
  pop(): number {
    const it = this.items, ks = this.keys
    const top = it[0]
    const li = it.pop()!
    const lk = ks.pop()!
    const len = it.length
    if (len) {
      let n = 0
      for (;;) {
        let c = 2 * n + 1
        if (c >= len) break
        if (c + 1 < len && ks[c + 1] < ks[c]) c++
        if (ks[c] >= lk) break
        it[n] = it[c]
        ks[n] = ks[c]
        n = c
      }
      it[n] = li
      ks[n] = lk
    }
    return top
  }
  get size() {
    return this.items.length
  }
  clear() {
    this.items.length = 0
    this.keys.length = 0
  }
}

export class PathFinder {
  g: Float32Array
  came: Int32Array
  stamp: Uint32Array
  closed: Uint32Array
  run = 1
  heap = new Heap()
  /** which tiles this finder may use: ground units by default, boats with `navI` */
  pass: (i: number) => boolean
  constructor(public map: GameMap, pass?: (i: number) => boolean) {
    this.pass = pass ?? ((i) => map.walkI(i))
    const n = map.N * map.N
    this.g = new Float32Array(n)
    this.came = new Int32Array(n)
    this.stamp = new Uint32Array(n)
    this.closed = new Uint32Array(n)
  }

  ok(x: number, y: number): boolean {
    const N = this.map.N
    return x >= 0 && y >= 0 && x < N && y < N && this.pass(y * N + x)
  }

  /** the nearest tile a unit of this kind can stand on */
  nearestWalkable(x: number, y: number, maxR = 12): { x: number; y: number } | null {
    const m = this.map
    const tx = Math.floor(x), ty = Math.floor(y)
    if (this.ok(tx, ty)) return { x: tx, y: ty }
    for (let r = 1; r <= maxR; r++) {
      let best: { x: number; y: number } | null = null
      let bd = 1e9
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          if (!this.ok(tx + dx, ty + dy)) continue
          const d = Math.hypot(tx + dx + 0.5 - x, ty + dy + 0.5 - y)
          if (d < bd) {
            bd = d
            best = { x: tx + dx, y: ty + dy }
          }
        }
      if (best) return best
    }
    return null
  }

  /**
   * A path of tile indices from (sx,sy) to (gx,gy). If the goal cannot be reached, the path leads
   * to the closest place that can. `allow` lets a few tiles count as open (a unit's own building).
   */
  find(sx: number, sy: number, gx: number, gy: number, maxNodes = 6000): number[] {
    const m = this.map
    const N = m.N
    const start = m.idx(sx, sy)
    let goal = m.idx(gx, gy)
    if (!this.pass(goal)) {
      const w = this.nearestWalkable(gx + 0.5, gy + 0.5)
      if (!w) return []
      gx = w.x
      gy = w.y
      goal = m.idx(gx, gy)
    }
    if (start === goal) return [goal]
    const run = ++this.run
    const g = this.g, came = this.came, stamp = this.stamp, closed = this.closed
    const heap = this.heap
    heap.clear()
    stamp[start] = run
    g[start] = 0
    came[start] = -1
    const h = (x: number, y: number) => {
      const dx = Math.abs(x - gx), dy = Math.abs(y - gy)
      return (dx + dy + (1.4142 - 2) * Math.min(dx, dy)) * 1.05
    }
    heap.push(start, h(sx, sy))
    let best = start
    let bestH = h(sx, sy)
    let nodes = 0
    while (heap.size) {
      const cur = heap.pop()
      if (closed[cur] === run) continue
      closed[cur] = run
      if (cur === goal) {
        best = cur
        break
      }
      if (++nodes > maxNodes) break
      const cx = cur % N, cy = (cur / N) | 0
      const hc = h(cx, cy)
      if (hc < bestH) {
        bestH = hc
        best = cur
      }
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = cx + dx, ny = cy + dy
          if (nx < 0 || ny < 0 || nx >= N || ny >= N) continue
          const ni = ny * N + nx
          if (!this.pass(ni)) continue
          if (dx && dy && (!this.pass(cy * N + nx) || !this.pass(ny * N + cx))) continue
          const t = m.ter[ni]
          const step = (dx && dy ? 1.4142 : 1) * (t === Ter.Road || t === Ter.Bridge ? 0.75 : 1)
          const ng = g[cur] + step
          if (stamp[ni] === run && ng >= g[ni]) continue
          stamp[ni] = run
          g[ni] = ng
          came[ni] = cur
          heap.push(ni, ng + h(nx, ny))
        }
    }
    const path: number[] = []
    let c = best
    while (c !== -1 && c !== start) {
      path.push(c)
      c = came[c]
    }
    path.reverse()
    return this.smooth(sx + 0.5, sy + 0.5, path)
  }

  /** is the straight line between two points clear of obstacles (with a little width) */
  clear(ax: number, ay: number, bx: number, by: number, half = 0.3): boolean {
    const m = this.map
    const d = Math.hypot(bx - ax, by - ay)
    const n = Math.ceil(d / 0.25)
    const px = -(by - ay) / (d || 1), py = (bx - ax) / (d || 1)
    for (let k = 1; k <= n; k++) {
      const t = k / n
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t
      if (!this.ok(Math.floor(x + px * half), Math.floor(y + py * half))) return false
      if (!this.ok(Math.floor(x - px * half), Math.floor(y - py * half))) return false
    }
    return true
  }

  smooth(sx: number, sy: number, path: number[]): number[] {
    if (path.length < 3) return path
    const N = this.map.N
    const out: number[] = []
    let ax = sx, ay = sy
    let k = 0
    while (k < path.length) {
      let far = k
      for (let j = Math.min(path.length - 1, k + 12); j > k; j--) {
        const bx = (path[j] % N) + 0.5, by = ((path[j] / N) | 0) + 0.5
        if (this.clear(ax, ay, bx, by)) {
          far = j
          break
        }
      }
      out.push(path[far])
      ax = (path[far] % N) + 0.5
      ay = ((path[far] / N) | 0) + 0.5
      k = far + 1
    }
    return out
  }
}
