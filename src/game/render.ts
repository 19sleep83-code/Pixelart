// Draws a frame into the low-resolution canvas, which the page shows scaled up with hard pixels.
//
// Order: ground (with its baked marks) → shadows → markers on the ground → everything that stands
// (trees, houses, ore, buildings, vehicles, wrecks), sorted back to front → helicopters → shells
// and smoke → health bars → fog → the player's cursor work.

import type { Game, Ent, Garrison } from './game'
import { SCHEMES } from './colors'
import type { Assets } from './assets'
import { mountOffset } from './assets'
import type { Terrain } from './terrain'
import { TW, TH, KZ, SCALE, unIso, css } from '../core/iso'

/** screen pixels per unit: everything drawn by hand scales with it */
const P = SCALE
import { makeCanvas, type Sprite } from '../core/voxel'
import { Ter } from './map'
import { hash2 } from '../core/rng'
import { HARVEST_LOAD } from './defs'
import { Atmos, type Light } from './atmos'

interface Drawable {
  k: number
  f: () => void
}

export interface Overlay {
  box?: { x0: number; y0: number; x1: number; y1: number }
  place?: { key: string; tx: number; ty: number; ok: boolean }
  hoverEnt?: Ent | null
  hoverG?: Garrison | null
  moveMark?: { x: number; y: number; t: number; attack: boolean }
}

export class Renderer {
  ctx: CanvasRenderingContext2D
  W = 320
  H = 200
  cam = { x: 0, y: 0 }
  fogCv: HTMLCanvasElement
  fogCtx: CanvasRenderingContext2D
  fogImg: ImageData
  private rings = new Map<string, HTMLCanvasElement>()
  private shake = 0
  atmos: Atmos
  /** film grain strength (0 = off) */
  grain = 0.05

  constructor(public game: Game, public A: Assets, public terrain: Terrain, public cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!
    const N = game.map.N
    this.fogCv = makeCanvas(N, N)
    this.fogCtx = this.fogCv.getContext('2d')!
    this.fogImg = this.fogCtx.createImageData(N, N)
    this.atmos = new Atmos(game.map, game.opts.tod, game.opts.weather)
  }

  resize(w: number, h: number) {
    this.W = Math.max(64, w)
    this.H = Math.max(64, h)
    this.cv.width = this.W
    this.cv.height = this.H
    this.ctx.imageSmoothingEnabled = false
    this.clampCam()
  }

  clampCam() {
    const N = this.game.map.N
    const half = (N * TW) / 2
    this.cam.x = Math.max(-half - 40 * P, Math.min(half - this.W + 40 * P, this.cam.x))
    this.cam.y = Math.max(-40 * P, Math.min(N * TH - this.H + 40 * P, this.cam.y))
  }

  /** centre the view on a world position */
  lookAt(x: number, y: number) {
    this.cam.x = Math.round((x - y) * (TW / 2) - this.W / 2)
    this.cam.y = Math.round((x + y) * (TH / 2) - this.H / 2)
    this.clampCam()
  }

  /** screen pixel → world tiles on the ground */
  toWorld(px: number, py: number): { x: number; y: number } {
    return unIso(px + this.cam.x, py + this.cam.y)
  }
  toScreen(x: number, y: number, z = 0): { x: number; y: number } {
    return { x: Math.round((x - y) * (TW / 2) - this.cam.x), y: Math.round((x + y) * (TH / 2) - z * KZ - this.cam.y) }
  }

  addShake(k: number) {
    this.shake = Math.min(7 * P, this.shake + k * P)
  }

  /** what stands under a screen pixel (topmost first) */
  pick(px: number, py: number): Ent | null {
    const g = this.game
    let best: Ent | null = null
    let bk = -1e9
    for (const e of g.ents) {
      if (e.dead) continue
      if (e.owner !== 0 && !this.shown(e)) continue
      if (e.isB) {
        // test the point at a few heights against the footprint
        for (let z = 0; z <= 26; z += 2) {
          const w = unIso(px + this.cam.x, py + this.cam.y + z * KZ)
          if (w.x >= e.tx && w.x < e.tx + e.w && w.y >= e.ty && w.y < e.ty + e.h) {
            const k = e.x + e.y - 0.5
            if (k > bk) {
              bk = k
              best = e
            }
            break
          }
        }
      } else {
        const s = this.toScreen(e.x, e.y, e.z)
        if (e.carriedBy || e.inside) continue
        const r = (e.u!.infantry ? 7 : e.naval ? (e.radius > 0.9 ? 26 : 17) : 13) * P
        const cy = s.y - (e.u!.infantry ? 8 : e.naval ? 8 : 6) * P
        if (Math.abs(px - s.x) <= r && Math.abs(py - cy) <= r) {
          const k = e.x + e.y + (e.air ? 100 : 0)
          if (k > bk) {
            bk = k
            best = e
          }
        }
      }
    }
    return best
  }

  /** a house (or bunker) that soldiers can hold under a screen pixel */
  pickGarrison(px: number, py: number): Garrison | null {
    const g = this.game
    const N = g.map.N
    let best: Garrison | null = null
    let bk = -1e9
    for (const h of g.garrisons) {
      if (!g.fog[h.ty * N + h.tx]) continue
      const top = h.kind === 'church' ? 40 : h.kind === 'bunker' ? 12 : 24
      for (let z = 0; z <= top; z += 2) {
        const w = unIso(px + this.cam.x, py + this.cam.y + z * KZ)
        if (w.x >= h.tx && w.x < h.tx + h.w && w.y >= h.ty && w.y < h.ty + h.h) {
          if (h.x + h.y > bk) {
            bk = h.x + h.y
            best = h
          }
          break
        }
      }
    }
    return best
  }

  private tops = new Map<Sprite, { h: number; dx: number }>()
  /** the highest solid pixel of a sprite: how far above its foot, and how far to the side */
  private topOf(sp: Sprite): { h: number; dx: number } {
    let t = this.tops.get(sp)
    if (t) return t
    t = { h: sp.ay, dx: 0 }
    const c = sp.cv.getContext('2d', { willReadFrequently: true })
    if (c) {
      const d = c.getImageData(0, 0, sp.w, sp.h).data
      outer: for (let y = 0; y < sp.h; y++)
        for (let x = 0; x < sp.w; x++)
          if (d[(y * sp.w + x) * 4 + 3] > 100) {
            t = { h: sp.ay - y, dx: x - sp.ax }
            break outer
          }
    }
    this.tops.set(sp, t)
    return t
  }

  /** the top of the roof (or tower) a flag flies from */
  private roofOf(h: Garrison): { h: number; dx: number } {
    const g = this.game
    if (h.b) return this.topOf(this.A.buildings[g.players[h.b.owner].faction][h.b.key].body)
    const st = g.map.tileStatics[g.map.idx(h.tx, h.ty)]?.find((s) => s.kind === 'house' || s.kind === 'timber' || s.kind === 'church' || s.kind === 'barn')
    if (!st) return { h: 24 * P, dx: 0 }
    const arr = this.A.statics[st.kind]
    return this.topOf(arr[st.v % arr.length].sp)
  }

  /** flags over the houses that are held, and how full they are */
  private drawGarrisons(o: Overlay, scr: (x: number, y: number, z?: number) => { x: number; y: number }, onScreen: (x: number, y: number, m?: number) => boolean) {
    const g = this.game
    const ctx = this.ctx
    const N = g.map.N
    for (const h of g.garrisons) {
      if (!onScreen(h.x, h.y)) continue
      const seen = g.fog[h.ty * N + h.tx] === 2
      const mineSel = h.occ.some((u) => u.selected)
      const hover = o.hoverG === h
      if ((mineSel || hover) && g.fog[h.ty * N + h.tx]) this.footprint(scr, h.tx, h.ty, h.w, h.h, mineSel ? 0x7dff6a : h.owner > 0 && h.occ.length ? 0xff5a4a : 0xd8ffd0, mineSel ? 1 : 0.7)
      if (!h.occ.length || h.owner < 0 || (h.owner !== 0 && !seen)) continue
      const roof = this.roofOf(h)
      const base = scr(h.x, h.y)
      base.x += roof.dx
      const top = base.y - roof.h + 3 * P
      const sc = SCHEMES[g.players[h.owner].faction]
      // the pole and a flag in the wind
      ctx.fillStyle = '#1a1c18'
      ctx.fillRect(base.x, top - 14 * P, P, 14 * P)
      const wave = Math.floor(g.time * 4 + h.id) % 2
      for (let k = 0; k < 7; k++) {
        const dy = (k + wave) % 4 < 2 ? 0 : P
        ctx.fillStyle = css(k < 1 ? sc.teamDark : sc.team)
        ctx.fillRect(base.x + P + k * P, top - 14 * P + dy, P, 4 * P)
        ctx.fillStyle = css(sc.teamLight)
        ctx.fillRect(base.x + P + k * P, top - 14 * P + dy, P, 1)
      }
      // our own: how many are inside
      if (h.owner === 0) {
        const w = h.cap * 4 * P - P
        const x0 = base.x - Math.round(w / 2) + 4 * P
        ctx.fillStyle = '#0c0e0a'
        ctx.fillRect(x0 - 1, top - 20 * P - 1, w + 2, 3 * P + 2)
        for (let i = 0; i < h.cap; i++) {
          ctx.fillStyle = i < h.occ.length ? '#e0b532' : '#3a3e34'
          ctx.fillRect(x0 + i * 4 * P, top - 20 * P, 3 * P, 3 * P)
        }
        // the weakest of them, as a bar
        const k = Math.min(...h.occ.map((u) => u.hp / u.maxHp))
        if (k < 1) {
          ctx.fillStyle = '#0c0e0a'
          ctx.fillRect(x0 - 1, top - 16 * P, w + 2, 2 * P + 1)
          ctx.fillStyle = k > 0.6 ? '#5fd65a' : k > 0.3 ? '#e8c03a' : '#e2492f'
          ctx.fillRect(x0, top - 16 * P + 1, Math.max(1, Math.round(w * k)), 2 * P - 1)
        }
      }
    }
  }

  /** is an entity of another player drawn */
  shown(e: Ent): boolean {
    const g = this.game
    if (e.carriedBy || e.inside) return false
    if (e.owner === 0) return true
    if (e.hidden && !g.visibleTo(0, e)) return false
    const N = g.map.N
    if (e.isB) {
      for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (g.fog[y * N + x]) return true
      return false
    }
    const tx = Math.floor(e.x), ty = Math.floor(e.y)
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return false
    return g.fog[ty * N + tx] === 2
  }

  private visiblePt(x: number, y: number): boolean {
    const N = this.game.map.N
    const tx = Math.floor(x), ty = Math.floor(y)
    if (tx < 0 || ty < 0 || tx >= N || ty >= N) return false
    return this.game.fog[ty * N + tx] === 2
  }

  private ring(rx: number, color: number): HTMLCanvasElement {
    const key = rx + ':' + color
    let c = this.rings.get(key)
    if (c) return c
    const W = rx * 2 + 3, H = rx + 3
    c = makeCanvas(W, H)
    const x = c.getContext('2d')!
    x.fillStyle = css(color)
    for (const rr of rx > 3 ? [rx, rx - 1] : [rx])
      for (let a = 0; a < 360; a += 1) {
        const t = (a / 180) * Math.PI
        x.fillRect(Math.round(W / 2 - 0.5 + Math.cos(t) * rr), Math.round(H / 2 - 0.5 + Math.sin(t) * rr * 0.5), 1, 1)
      }
    this.rings.set(key, c)
    return c
  }

  private drawSprite(sp: Sprite, x: number, y: number) {
    this.ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay)
  }

  draw(o: Overlay, dt = 1 / 60) {
    const g = this.game
    const A = this.A
    const ctx = this.ctx
    const N = g.map.N
    const T = this.terrain

    // marks waiting to be painted into the ground
    for (const s of g.stamps) {
      if (s.kind === 'scorch') T.stamp(A.scorch[s.size], s.x, s.y)
      else T.stamp(A.rubble[Math.max(0, s.size - 1)], s.x, s.y)
    }
    g.stamps.length = 0
    for (const i of g.oreChanged) T.repaintTile(i % N, Math.floor(i / N))
    g.oreChanged.length = 0

    let sx0 = 0, sy0 = 0
    if (this.shake > 0.05) {
      sx0 = Math.round((Math.random() - 0.5) * this.shake * 2)
      sy0 = Math.round((Math.random() - 0.5) * this.shake * 2)
      this.shake *= 0.86
    }
    const camX = this.cam.x + sx0, camY = this.cam.y + sy0
    const cam = { x: camX, y: camY }
    const scr = (x: number, y: number, z = 0) => ({ x: Math.round((x - y) * (TW / 2) - camX), y: Math.round((x + y) * (TH / 2) - z * KZ - camY) })

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#141a12'
    ctx.fillRect(0, 0, this.W, this.H)
    T.draw(ctx, camX, camY, this.W, this.H)

    // the tiles in view (with a margin for tall things)
    const c0 = unIso(camX - 40 * P, camY - 60 * P), c1 = unIso(camX + this.W + 40 * P, camY - 60 * P)
    const c2 = unIso(camX - 40 * P, camY + this.H + 60 * P), c3 = unIso(camX + this.W + 40 * P, camY + this.H + 60 * P)
    const tx0 = Math.max(0, Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)))
    const tx1 = Math.min(N - 1, Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)))
    const ty0 = Math.max(0, Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)))
    const ty1 = Math.min(N - 1, Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)))
    const onScreen = (x: number, y: number, m = 60 * P) => {
      const s = scr(x, y)
      return s.x > -m && s.x < this.W + m && s.y > -m && s.y < this.H + m * 1.5
    }
    const atm = this.atmos
    atm.water(ctx, camX, camY, g.time, tx0, ty0, tx1, ty1)

    // shadows
    for (const e of g.ents) {
      if (e.dead || !onScreen(e.x, e.y) || !this.shown(e)) continue
      const f = g.players[e.owner].faction
      if (e.isB) {
        if (e.built < 1) continue
        const art = A.buildings[f][e.key]
        const s = scr(e.x, e.y)
        this.drawSprite(art.shadow, s.x, s.y)
      } else {
        const art = A.units[f][e.key]
        const sh = art.hull.shadowAt(e.dir)
        if (e.air) {
          const k = e.z * 0.85 * (e.jet ? 0.7 : 1)
          const s = scr(e.x + k * 0.035, e.y + k * 0.016)
          ctx.globalAlpha = 0.7
          this.drawSprite(sh, s.x, s.y)
          ctx.globalAlpha = 1
        } else {
          const s = scr(e.x, e.y)
          this.drawSprite(sh, s.x, s.y)
        }
      }
    }

    // markers on the ground: selection rings, building outlines, rally points
    for (const e of g.ents) {
      if (e.dead || e.carriedBy || e.inside || !onScreen(e.x, e.y)) continue
      const hover = o.hoverEnt === e
      if (!e.selected && !hover) continue
      if (e.owner !== 0 && !this.shown(e)) continue
      const col = e.owner === 0 ? (e.selected ? 0x7dff6a : 0xd8ffd0) : 0xff5a4a
      if (e.isB) continue
      {
        const s = scr(e.x, e.y)
        const r = Math.round((e.u!.infantry ? 5 : e.u!.radius * (e.naval ? 24 : 22)) * P)
        ctx.globalAlpha = e.selected ? 1 : 0.55
        ctx.drawImage(this.ring(r, col), s.x - r - 1, s.y - Math.floor(r / 2) - 1)
        ctx.globalAlpha = 1
      }
    }

    // everything that stands, back to front
    const list: Drawable[] = []
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * N + tx
        const st = g.fog[i] ? g.map.tileStatics[i] : undefined
        if (st)
          for (const s of st) {
            const arr = A.statics[s.kind]
            const art = arr[s.v % arr.length]
            list.push({ k: s.x + s.y, f: () => { const p = scr(s.x, s.y); this.drawSprite(art.sp, p.x, p.y) } })
          }
        if (g.map.ter[i] === Ter.Ore && g.map.ore[i] > 0) {
          const amt = g.map.ore[i]
          const stage = amt > 600 ? 2 : amt > 250 ? 1 : 0
          const sp = A.ore[stage][Math.floor(hash2(tx, ty, 5) * 3)]
          list.push({ k: tx + ty + 0.6, f: () => { const p = scr(tx + 0.5, ty + 0.5); this.drawSprite(sp, p.x, p.y) } })
        }
      }
    for (const w of g.wrecks) {
      if (!onScreen(w.x, w.y) || g.fog[Math.floor(w.y) * N + Math.floor(w.x)] === 0) continue
      const art = A.units[g.players[w.owner].faction][w.key]
      if (!art.wreck) continue
      const fade = w.naval ? Math.max(0, 1 - w.t / 9) : w.t > 34 ? 1 - (w.t - 34) / 6 : 1
      list.push({
        k: w.x + w.y,
        f: () => {
          const p = scr(w.x, w.y)
          ctx.globalAlpha = fade
          if (w.naval) {
            // going down: only what is still above the water shows
            ctx.save()
            ctx.beginPath()
            ctx.rect(0, 0, this.W, p.y + 3)
            ctx.clip()
            const sink = Math.round(w.t * w.t * 0.35)
            const tilt = Math.min(0.6, w.t * 0.08)
            this.drawSprite(art.wreck!.at(w.dir + tilt), p.x, p.y + sink)
            ctx.restore()
            ctx.globalAlpha = 1
            return
          }
          this.drawSprite(art.wreck!.at(w.dir), p.x, p.y)
          if (art.wreckTurret) {
            const [dx, dy] = mountOffset(art.mount, w.dir)
            this.drawSprite(art.wreckTurret.at(w.tdir), p.x + dx, p.y + dy)
          }
          ctx.globalAlpha = 1
        },
      })
    }
    const airList: Ent[] = []
    for (const e of g.ents) {
      if (e.dead || !onScreen(e.x, e.y, 90 * P) || !this.shown(e)) continue
      if (e.air && e.z > 3) {
        airList.push(e)
        continue
      }
      list.push({ k: e.x + e.y + (e.air ? 0.3 : 0), f: () => this.drawEnt(e, scr) })
    }
    list.sort((a, b) => a.k - b.k)
    for (const d of list) d.f()
    airList.sort((a, b) => a.z - b.z || a.x + a.y - b.x - b.y)
    for (const e of airList) this.drawEnt(e, scr)

    // cloud shadows drift over everything on the ground
    atm.clouds(ctx, camX, camY, this.W, this.H, g.time)

    // selected buildings get corner brackets on top
    for (const e of g.ents) {
      if (!e.isB || e.dead || (!e.selected && o.hoverEnt !== e) || !onScreen(e.x, e.y)) continue
      if (e.owner !== 0 && !this.shown(e)) continue
      const col = e.owner === 0 ? 0x7dff6a : 0xff5a4a
      this.footprint(scr, e.tx, e.ty, e.w, e.h, col, e.selected ? 0.9 : 0.5)
    }

    // smoke, dust and water: lit like the ground around them
    for (const f of g.fx) {
      if (f.t < 0 || !this.visiblePt(f.x, f.y)) continue
      const q = scr(f.x, f.y, f.z)
      const k = f.t / f.life
      switch (f.kind) {
        case 'smoke':
        case 'dust': {
          // the heavy smoke of a blast is dark, big and grows as it rises
          const heavy = f.kind === 'smoke' && f.size >= 4
          const set = f.kind === 'dust' ? A.dust : heavy ? A.soot : A.smoke
          const r = heavy ? Math.min(set.length - 1, Math.round(f.size * 0.9 + k * 7) - 2) : Math.min(8, Math.round(f.size + k * 3) - 1)
          const sp = set[Math.max(0, r)]
          ctx.globalAlpha = (1 - k) * (f.kind === 'dust' ? 0.5 : heavy ? 0.85 : 0.7)
          this.drawSprite(sp, q.x, q.y)
          ctx.globalAlpha = 1
          break
        }
        case 'debris':
          ctx.fillStyle = k < 0.25 ? '#ffb050' : '#2a2622'
          ctx.fillRect(q.x, q.y, (f.size >= 3 ? 4 : 2) * P, (f.size >= 3 ? 3 : 1) * P)
          break
        case 'clod': {
          // earth thrown up by a blast
          ctx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1
          const h = hash2(Math.round(f.vx * 1000), Math.round(f.life * 1000), 3)
          ctx.fillStyle = h < 0.35 ? '#4a3a28' : h < 0.7 ? '#6a5438' : '#2e261e'
          ctx.fillRect(q.x, q.y, f.size * P - 1, (f.size - 1 || 1) * P)
          ctx.fillStyle = '#8a7252'
          ctx.fillRect(q.x, q.y, f.size >= 3 ? 2 : 1, 1)
          ctx.globalAlpha = 1
          break
        }
        case 'wake': {
          // foam spreading behind a boat
          const r = Math.round(f.size * P * (0.6 + k * 1.4))
          ctx.globalAlpha = (1 - k) * 0.75
          ctx.fillStyle = '#eef6f6'
          ctx.fillRect(q.x - r, q.y, r * 2 + 1, 1)
          ctx.fillRect(q.x - r + 2, q.y + 1, r * 2 - 3, 1)
          if (r > 2) {
            ctx.fillStyle = '#c8dde2'
            ctx.fillRect(q.x - r + 1, q.y - 1, 2, 1)
            ctx.fillRect(q.x + r - 2, q.y + 2, 2, 1)
          }
          ctx.globalAlpha = 1
          break
        }
        case 'splash': {
          // a column of water and its ring
          const h = Math.round(Math.sin(Math.min(1, k * 1.4) * Math.PI) * (6 + f.size * 6) * P)
          const w = (1 + f.size) * P
          ctx.globalAlpha = 1 - k * 0.7
          ctx.fillStyle = '#e8f2f6'
          ctx.fillRect(q.x - w, q.y - h, w * 2, h)
          ctx.fillStyle = '#b8d4e0'
          ctx.fillRect(q.x - w, q.y - h, P, h)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(q.x - Math.round(w / 2), q.y - h, w, P)
          const rr = Math.round((2 + k * (5 + f.size * 3)) * P)
          ctx.drawImage(this.ring(rr, 0xd8eef4), q.x - rr - 1, q.y - Math.floor(rr / 2) - 1)
          ctx.globalAlpha = 1
          break
        }
      }
    }

    // the hour of the day and the weather, then whatever glows
    atm.grade(ctx, this.W, this.H)
    const level = atm.lightLevel
    const lights: Light[] = []
    if (level > 0) this.collectLights(lights, level, scr, onScreen, tx0, ty0, tx1, ty1)
    for (const f of g.fx) {
      if (f.t < 0 || !this.visiblePt(f.x, f.y)) continue
      const q = scr(f.x, f.y, f.z)
      const k = f.t / f.life
      if (f.kind === 'exp') lights.push({ x: q.x, y: q.y - 4 * P, r: (20 + f.size * 16) * P, color: 'rgba(255,170,80,0.95)', a: (1 - k) * (0.55 + level * 0.5) })
      else if (f.kind === 'ember') lights.push({ x: q.x, y: q.y, r: 3 * P, color: 'rgba(255,170,60,1)', a: (1 - k) * (0.5 + level * 0.5) })
      else if (f.kind === 'fire') lights.push({ x: q.x, y: q.y - 3 * P, r: 12 * P, color: 'rgba(255,140,50,0.8)', a: 0.25 + level * 0.6 })
      else if (f.kind === 'flash') lights.push({ x: q.x, y: q.y, r: (6 + f.size * 3) * P, color: 'rgba(255,230,160,0.9)', a: 0.4 + level * 0.6 })
    }
    atm.lights(ctx, lights, (r, c) => A.glowOf(r, c))

    // shells and rockets
    for (const s of g.shots) {
      const p = g.shotPos(s)
      if (!this.visiblePt(p.x, p.y) && !this.visiblePt(s.x0, s.y0)) continue
      const q = scr(p.x, p.y, p.z)
      switch (s.kind) {
        case 'bullet':
        case 'flak': {
          const prev = g.shotPos({ ...s, t: Math.max(0, s.t - 0.03) })
          const r = scr(prev.x, prev.y, prev.z)
          this.line(r.x, r.y, q.x, q.y, s.kind === 'flak' ? '#ffb45a' : '#ffeaa0')
          break
        }
        case 'shell':
          ctx.fillStyle = '#fff4c0'
          ctx.fillRect(q.x - 2, q.y, 4, 2)
          break
        case 'rocket':
        case 'mlrs':
          ctx.fillStyle = '#e8e2d0'
          ctx.fillRect(q.x - 2, q.y - 1, 4, 3)
          ctx.fillStyle = '#ffd060'
          ctx.fillRect(q.x, q.y, 2, 2)
          break
        case 'missile': {
          ctx.fillStyle = '#d8dcd8'
          ctx.fillRect(q.x - 3, q.y - 1, 6, 3)
          ctx.fillStyle = '#ffe080'
          ctx.fillRect(q.x - 1, q.y, 2, 2)
          break
        }
        case 'snipe': {
          const prev = g.shotPos({ ...s, t: Math.max(0, s.t - 0.05) })
          const r = scr(prev.x, prev.y, prev.z)
          ctx.globalAlpha = 0.7
          this.line(r.x, r.y, q.x, q.y, '#ffffff')
          ctx.globalAlpha = 1
          break
        }
        case 'art': {
          const gq = scr(p.x, p.y)
          ctx.fillStyle = 'rgba(0,0,0,0.3)'
          ctx.fillRect(gq.x - 2, gq.y, 4, 2)
          ctx.fillStyle = '#2a2a28'
          ctx.fillRect(q.x - 2, q.y - 2, 4, 4)
          ctx.fillStyle = '#ffe6a0'
          ctx.fillRect(q.x, q.y - 2, 2, 1)
          break
        }
      }
    }

    // smoke, fire and explosions
    for (const f of g.fx) {
      if (f.t < 0 || !this.visiblePt(f.x, f.y)) continue
      const q = scr(f.x, f.y, f.z)
      const k = f.t / f.life
      switch (f.kind) {
        case 'exp': {
          const frames = A.explosions[Math.min(3, f.size)]
          const fr = frames[Math.min(frames.length - 1, Math.floor(k * frames.length))]
          const sc = f.scale ?? 1
          if (sc !== 1) ctx.drawImage(fr.cv, Math.round(q.x - fr.ax * sc), Math.round(q.y - fr.ay * sc), Math.round(fr.w * sc), Math.round(fr.h * sc))
          else this.drawSprite(fr, q.x, q.y)
          if (!f.shook && f.size >= 1) {
            f.shook = true
            this.addShake([0.4, 1.4, 2.8, 4.5][f.size])
          }
          if (f.t < 0.05 && f.size >= 1) {
            if (f.size >= 2) {
              // the whole view lights up for a moment
              ctx.globalCompositeOperation = 'lighter'
              ctx.fillStyle = `rgba(255,220,170,${0.09 * f.size * (1 - f.t / 0.05)})`
              ctx.fillRect(0, 0, this.W, this.H)
              ctx.globalCompositeOperation = 'source-over'
            }
          }
          break
        }
        case 'fire': {
          const sp = A.fire[Math.floor(f.t * 14 + f.x * 7) % A.fire.length]
          this.drawSprite(sp, q.x, q.y)
          break
        }
        case 'flash': {
          ctx.globalCompositeOperation = 'lighter'
          if (f.size > 3) {
            const r = Math.round(f.size * 3 * P * (1 - k * 0.5))
            ctx.globalAlpha = 1 - k
            ctx.drawImage(A.glowOf(r, 'rgba(255,240,200,1)'), q.x - r, q.y - r)
            ctx.globalAlpha = 1
          } else {
            const r = Math.round(f.size * P)
            ctx.drawImage(A.glowOf(r * 2, 'rgba(255,236,170,1)'), q.x - r * 2, q.y - r * 2)
          }
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(q.x - P, q.y - P, P * 2, P * 2)
          ctx.globalCompositeOperation = 'source-over'
          break
        }
        case 'ring': {
          // the pressure wave
          const rr = Math.round((3 + k * (10 + f.size * 15)) * P)
          ctx.globalAlpha = (1 - k) * 0.75
          ctx.drawImage(this.ring(rr, 0xfff0d2), q.x - rr - 1, q.y - Math.floor(rr / 2) - 1)
          if (rr > 4) {
            const r2 = Math.round(rr * 0.8)
            ctx.globalAlpha = (1 - k) * 0.5
            ctx.drawImage(this.ring(r2, 0xb4a07c), q.x - r2 - 1, q.y - Math.floor(r2 / 2) - 1)
          }
          ctx.globalAlpha = 1
          break
        }
        case 'ember':
          ctx.fillStyle = k < 0.5 ? '#ffe070' : '#ff7a28'
          ctx.fillRect(q.x, q.y, P, k < 0.3 ? P * 2 : P)
          break
        case 'spark':
          ctx.fillStyle = k < 0.5 ? '#fff0a0' : '#ff9a40'
          ctx.fillRect(q.x + Math.round(Math.sin(f.t * 40) * 2 * P), q.y - Math.round(k * 3 * P), P, P)
          ctx.fillRect(q.x - Math.round(Math.cos(f.t * 37) * 2 * P), q.y - Math.round(k * 2 * P), P, P)
          break
      }
    }

    atm.rain(ctx, this.W, this.H, dt, Math.random)

    // health bars
    for (const e of g.ents) {
      if (e.dead || e.carriedBy || e.inside || !onScreen(e.x, e.y)) continue
      const show = e.selected || o.hoverEnt === e || (e.hp < e.maxHp && g.time - e.lastHit < 3)
      if (!show || !this.shown(e)) continue
      const k = Math.max(0, e.hp / e.maxHp)
      let w: number, x: number, y: number
      if (e.isB) {
        const art = A.buildings[g.players[e.owner].faction][e.key]
        const s = scr(e.x, e.y)
        w = e.w * 12 * P
        x = s.x - w / 2
        y = s.y - art.body.ay + 2 * P
      } else {
        const s = scr(e.x, e.y, e.z)
        w = (e.u!.infantry ? 10 : e.naval ? (e.radius > 0.9 ? 30 : 22) : 18) * P
        x = s.x - w / 2
        y = s.y - (e.u!.infantry ? 22 : e.air ? 28 : e.naval ? (e.radius > 0.9 ? 40 : 28) : 22) * P
      }
      ctx.fillStyle = '#0c0e0a'
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, w + 2, 6)
      ctx.fillStyle = k > 0.6 ? '#5fd65a' : k > 0.3 ? '#e8c03a' : '#e2492f'
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w * k)), 4)
      ctx.fillStyle = 'rgba(255,255,255,0.25)'
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w * k)), 1)
      // rank stripes
      if (e.rank > 0) this.chevrons(Math.round(x) + w + 3, Math.round(y) - 2, e.rank)
      // a landing ship shows who is aboard
      if (e.u?.transport && e.owner === 0) {
        for (let i = 0; i < e.u.transport; i++) {
          ctx.fillStyle = i < e.passengers.length ? '#e0b532' : '#0c0e0a'
          ctx.fillRect(Math.round(x) + i * 6, Math.round(y) + 6, 4, 4)
        }
      }
      // a harvester shows its load
      if (e.u?.harvester && e.owner === 0) {
        ctx.fillStyle = '#0c0e0a'
        ctx.fillRect(Math.round(x) - 1, Math.round(y) + 5, w + 2, 4)
        ctx.fillStyle = '#e0b532'
        ctx.fillRect(Math.round(x), Math.round(y) + 6, Math.round((w * e.cargo) / HARVEST_LOAD), 2)
      }
    }

    this.drawGarrisons(o, scr, onScreen)

    // fog of war
    if (g.fogDirty) {
      const d = new Uint32Array(this.fogImg.data.buffer)
      for (let i = 0; i < d.length; i++) {
        const f = g.fog[i]
        d[i] = f === 2 ? 0 : f === 1 ? 0x780a0d0b : 0xff0a0d0b
      }
      this.fogCtx.putImageData(this.fogImg, 0, 0)
      g.fogDirty = false
    }
    ctx.imageSmoothingEnabled = true
    ctx.setTransform(TW / 2, TH / 2, -TW / 2, TH / 2, -camX, -camY)
    ctx.drawImage(this.fogCv, 0, 0)
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.imageSmoothingEnabled = false
    atm.filmGrain(ctx, this.W, this.H, this.grain)

    // rally points of selected buildings
    for (const e of g.ents) {
      if (!e.selected || !e.isB || !e.rally || e.owner !== 0) continue
      const a = scr(e.x, e.y), b = scr(e.rally.x, e.rally.y)
      this.dashed(a.x, a.y, b.x, b.y, '#9cff8a')
      ctx.fillStyle = '#9cff8a'
      ctx.fillRect(b.x - 1, b.y - 6 * P, P, 6 * P)
      ctx.fillRect(b.x, b.y - 6 * P, 3 * P, 2 * P)
    }
    // where a move order went
    if (o.moveMark) {
      const m = o.moveMark
      const k = Math.min(1, (g.time - m.t) / 0.5)
      if (k < 1) {
        const s = scr(m.x, m.y)
        const r = Math.round((7 * (1 - k) + 2) * P)
        ctx.drawImage(this.ring(r, m.attack ? 0xff5a4a : 0x7dff6a), s.x - r - 1, s.y - Math.floor(r / 2) - 1)
      }
    }
    // placing a building
    if (o.place) {
      const p = o.place
      const def = g.bdefs[p.key]
      const art = A.buildings[g.me.faction][p.key]
      const s = scr(p.tx + def.w / 2, p.ty + def.h / 2)
      ctx.globalAlpha = 0.55
      this.drawSprite(art.body, s.x, s.y)
      ctx.globalAlpha = 1
      for (let y = p.ty; y < p.ty + def.h; y++)
        for (let x = p.tx; x < p.tx + def.w; x++) {
          const ok = p.ok && g.map.buildable(x, y)
          this.tile(scr, x, y, ok ? 'rgba(90,255,110,0.30)' : 'rgba(255,70,50,0.45)')
        }
    }
    if (o.box) {
      const b = o.box
      const x = Math.min(b.x0, b.x1), y = Math.min(b.y0, b.y1)
      const w = Math.abs(b.x1 - b.x0), h = Math.abs(b.y1 - b.y0)
      ctx.fillStyle = 'rgba(120,255,110,0.12)'
      ctx.fillRect(x, y, w, h)
      ctx.fillStyle = '#7dff6a'
      ctx.fillRect(x, y, w, 1)
      ctx.fillRect(x, y + h, w + 1, 1)
      ctx.fillRect(x, y, 1, h)
      ctx.fillRect(x + w, y, 1, h)
    }
    void cam
  }

  private drawEnt(e: Ent, scr: (x: number, y: number, z?: number) => { x: number; y: number }) {
    const g = this.game
    const A = this.A
    const ctx = this.ctx
    const f = g.players[e.owner].faction
    if (e.isB) {
      const art = A.buildings[f][e.key]
      const s = scr(e.x, e.y)
      const sp = art.body
      if (e.built < 1) {
        // rises out of the ground
        const top = Math.floor(sp.h * (1 - e.built))
        ctx.drawImage(sp.cv, 0, top, sp.w, sp.h - top, s.x - sp.ax, s.y - sp.ay + top, sp.w, sp.h - top)
        if (Math.random() < 0.3) g.addFx('dust', e.tx + Math.random() * e.w, e.ty + e.h, 1, 0, 0, 3, 0.8, 2)
        return
      }
      this.drawSprite(sp, s.x, s.y)
      if (art.turret) {
        const [dx, dy] = mountOffset(art.mount, 0)
        this.drawSprite(art.turret.at(e.tdir), s.x + dx, s.y + dy)
      }
      return
    }
    const art = A.units[f][e.key]
    const s = scr(e.x, e.y, e.z)
    const flash = g.time - e.flashT < 0.07
    // a sniper in hiding is a ghost to its own side
    if (e.hidden) ctx.globalAlpha = 0.45
    if (e.u!.infantry) {
      const aiming = !e.moving && (g.time - e.firedT < 0.8 || (!!e.target && !e.target.dead))
      const fr = e.moving ? (Math.floor(e.anim * 7) % 2 ? art.alt! : art.alt2!) : aiming && art.aim ? art.aim : art.hull
      this.drawSprite(fr.at(e.dir), s.x, s.y)
      if (flash) this.flashSprite(fr.at(e.dir), s.x, s.y)
      ctx.globalAlpha = 1
      return
    }
    // the tracks run while it drives; radars on ships keep turning
    let hull = e.u!.harvester && e.cargo > 0 && art.alt ? art.alt : art.hull
    if (art.hull2 && e.moving && Math.floor(e.anim * 12) % 2) hull = art.hull2
    if (art.hullAnim) hull = art.hullAnim[Math.floor(g.time * 3 + e.id) % art.hullAnim.length]
    const turret = art.turretAnim ? art.turretAnim[Math.floor(g.time * 4 + e.id) % art.turretAnim.length] : art.turret
    // a little bounce while driving, a slow roll on the water
    const bob = e.naval ? Math.round(Math.sin(g.time * 1.4 + e.id) * 0.7) : e.moving && !e.air && Math.floor(e.anim * 8) % 2 ? -1 : 0
    this.drawSprite(hull.at(e.dir), s.x, s.y + bob)
    if (flash) this.flashSprite(hull.at(e.dir), s.x, s.y + bob)
    if (turret) {
      const [dx, dy] = mountOffset(art.mount, e.dir)
      this.drawSprite(turret.at(e.tdir), s.x + dx, s.y + dy + bob)
      if (flash) this.flashSprite(turret.at(e.tdir), s.x + dx, s.y + dy + bob)
    }
    ctx.globalAlpha = 1
    if (e.jet && e.js !== 'park' && e.z > 3) {
      // afterburner
      const tx = -Math.cos(e.dir) * 0.55, ty = -Math.sin(e.dir) * 0.55
      const q = scr(e.x + tx, e.y + ty, e.z + 2)
      ctx.fillStyle = '#ff8a30'
      ctx.fillRect(q.x - 3, q.y - 2, 6, 4)
      ctx.fillStyle = '#fff2b0'
      ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
    }
    if (art.rotor) {
      // two blades turning fast, with a faint blur disc
      const [dx, dy] = mountOffset([0, 0, art.rotor.z], e.dir)
      const cx = s.x + dx, cy = s.y + dy
      const r = art.rotor.r * P
      ctx.globalAlpha = 0.16
      ctx.fillStyle = '#d8dcd0'
      ctx.beginPath()
      ctx.ellipse(cx, cy, r * 1.35, r * 0.68, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
      const a = g.time * 22 + e.id
      for (const off of [0, Math.PI / 2]) {
        const bx = Math.cos(a + off) * r, by = Math.sin(a + off) * r
        const ex = bx - by, ey = (bx + by) / 2
        this.line(Math.round(cx - ex), Math.round(cy - ey), Math.round(cx + ex), Math.round(cy + ey), '#2a2c28')
      }
    }
  }

  /** the white blink of a hit */
  private flashSprite(sp: Sprite, x: number, y: number) {
    const ctx = this.ctx
    ctx.globalCompositeOperation = 'lighter'
    ctx.globalAlpha = 0.55
    this.drawSprite(sp, x, y)
    ctx.globalAlpha = 1
    ctx.globalCompositeOperation = 'source-over'
  }

  /** rank stripes: one or two chevrons, a star for a veteran */
  private chevrons(x: number, y: number, rank: number) {
    const ctx = this.ctx
    const px = (a: number, b: number, w: number, h: number) => ctx.fillRect(x + a * P, y + b * P, w * P, h * P)
    ctx.fillStyle = '#0c0e0a'
    px(-1, -1, 7, rank >= 3 ? 7 : rank * 3 + 1)
    ctx.fillStyle = '#f0c840'
    if (rank >= 3) {
      px(2, 0, 1, 5)
      px(0, 2, 5, 1)
      px(1, 1, 3, 3)
      return
    }
    for (let k = 0; k < rank; k++) {
      const yy = k * 3
      px(0, yy, 1, 1)
      px(1, yy + 1, 1, 1)
      px(2, yy + 1, 1, 1)
      px(3, yy + 1, 1, 1)
      px(4, yy, 1, 1)
    }
  }

  /** what shines in the dark: windows, headlights, navigation lights */
  private collectLights(out: Light[], level: number, scr: (x: number, y: number, z?: number) => { x: number; y: number }, onScreen: (x: number, y: number, m?: number) => boolean, tx0: number, ty0: number, tx1: number, ty1: number) {
    const g = this.game
    const N = g.map.N
    const blink = Math.floor(g.time * 1.5) % 2 === 0
    for (const e of g.ents) {
      if (e.dead || e.carriedBy || e.inside || !onScreen(e.x, e.y) || !this.shown(e)) continue
      if (e.isB) {
        if (e.built < 1) continue
        const n = Math.min(2, e.w + e.h - 2)
        for (let k = 0; k < n; k++) {
          const q = scr(e.tx + 0.3 + hash2(e.id, k, 1) * (e.w - 0.6), e.ty + 0.3 + hash2(e.id, k, 2) * (e.h - 0.6), 6 + hash2(e.id, k, 3) * 6)
          out.push({ x: q.x, y: q.y, r: 8 * P, color: 'rgba(255,214,140,0.85)', a: level * 0.75 })
        }
        if (blink) {
          const q = scr(e.x, e.y, 16 + e.w * 3)
          out.push({ x: q.x, y: q.y, r: 4 * P, color: e.owner === 0 ? 'rgba(120,255,120,1)' : 'rgba(255,90,70,1)', a: level })
        }
        continue
      }
      if (e.u!.infantry) continue
      if (e.air) {
        const q = scr(e.x, e.y, e.z)
        if (blink) out.push({ x: q.x, y: q.y, r: 4 * P, color: 'rgba(255,70,60,1)', a: level })
        continue
      }
      if (e.naval) {
        const q = scr(e.x, e.y, 8)
        out.push({ x: q.x, y: q.y, r: (10 + e.radius * 8) * P, color: 'rgba(255,220,150,0.8)', a: level * 0.6 })
        const l = scr(e.x - Math.sin(e.dir) * e.radius * 0.5, e.y + Math.cos(e.dir) * e.radius * 0.5, 6)
        const r = scr(e.x + Math.sin(e.dir) * e.radius * 0.5, e.y - Math.cos(e.dir) * e.radius * 0.5, 6)
        out.push({ x: l.x, y: l.y, r: 3 * P, color: 'rgba(80,255,120,1)', a: level }, { x: r.x, y: r.y, r: 3 * P, color: 'rgba(255,60,60,1)', a: level })
        continue
      }
      // headlights on the ground ahead
      const q = scr(e.x + Math.cos(e.dir) * 0.8, e.y + Math.sin(e.dir) * 0.8, 1)
      out.push({ x: q.x, y: q.y, r: 10 * P, color: 'rgba(255,245,210,0.8)', a: level * 0.7 })
    }
    // windows in the villages
    for (let ty = ty0; ty <= ty1; ty++)
      for (let tx = tx0; tx <= tx1; tx++) {
        const i = ty * N + tx
        const st = g.fog[i] ? g.map.tileStatics[i] : undefined
        if (!st) continue
        for (const s of st) {
          if (s.kind === 'oak' || s.kind === 'pine' || s.kind === 'birch' || s.kind === 'barn') continue
          const q = scr(s.x + 0.2, s.y + 0.2, 4)
          out.push({ x: q.x, y: q.y, r: 8 * P, color: 'rgba(255,200,120,0.85)', a: level * 0.8 })
        }
      }
  }

  private line(x0: number, y0: number, x1: number, y1: number, col: string, t = 1) {
    const ctx = this.ctx
    ctx.fillStyle = col
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), t, t)
  }

  private dashed(x0: number, y0: number, x1: number, y1: number, col: string) {
    const ctx = this.ctx
    ctx.fillStyle = col
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) if ((i >> 3) % 2 === 0) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 2, 2)
  }

  private tile(scr: (x: number, y: number) => { x: number; y: number }, tx: number, ty: number, fill: string) {
    const ctx = this.ctx
    const a = scr(tx, ty), b = scr(tx + 1, ty), c = scr(tx + 1, ty + 1), d = scr(tx, ty + 1)
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.moveTo(a.x, a.y)
    ctx.lineTo(b.x, b.y)
    ctx.lineTo(c.x, c.y)
    ctx.lineTo(d.x, d.y)
    ctx.closePath()
    ctx.fill()
  }

  private footprint(scr: (x: number, y: number) => { x: number; y: number }, tx: number, ty: number, w: number, h: number, col: number, alpha: number) {
    const a = scr(tx, ty), b = scr(tx + w, ty), c = scr(tx + w, ty + h), d = scr(tx, ty + h)
    const cs = css(col)
    this.ctx.globalAlpha = alpha
    // corner brackets
    const seg = (p: { x: number; y: number }, q: { x: number; y: number }) => {
      const k = 0.25
      this.line(p.x, p.y, Math.round(p.x + (q.x - p.x) * k), Math.round(p.y + (q.y - p.y) * k), cs, P)
      this.line(q.x, q.y, Math.round(q.x + (p.x - q.x) * k), Math.round(q.y + (p.y - q.y) * k), cs, P)
    }
    seg(a, b)
    seg(b, c)
    seg(c, d)
    seg(d, a)
    this.ctx.globalAlpha = 1
  }
}
