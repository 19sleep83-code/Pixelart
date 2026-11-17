// Draws a frame into the low-resolution canvas, which the page shows scaled up with hard pixels.
//
// Order: ground (with its baked marks) → shadows → markers on the ground → everything that stands
// (trees, houses, ore, buildings, vehicles, wrecks), sorted back to front → helicopters → shells
// and smoke → health bars → fog → the player's cursor work.

import type { Game, Ent } from './game'
import type { Assets } from './assets'
import { mountOffset } from './assets'
import type { Terrain } from './terrain'
import { TW, TH, KZ, unIso, css } from '../core/iso'
import { makeCanvas, type Sprite } from '../core/voxel'
import { Ter } from './map'
import { hash2 } from '../core/rng'
import { HARVEST_LOAD } from './defs'

interface Drawable {
  k: number
  f: () => void
}

export interface Overlay {
  box?: { x0: number; y0: number; x1: number; y1: number }
  place?: { key: string; tx: number; ty: number; ok: boolean }
  hoverEnt?: Ent | null
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

  constructor(public game: Game, public A: Assets, public terrain: Terrain, public cv: HTMLCanvasElement) {
    this.ctx = cv.getContext('2d')!
    const N = game.map.N
    this.fogCv = makeCanvas(N, N)
    this.fogCtx = this.fogCv.getContext('2d')!
    this.fogImg = this.fogCtx.createImageData(N, N)
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
    this.cam.x = Math.max(-half - 40, Math.min(half - this.W + 40, this.cam.x))
    this.cam.y = Math.max(-40, Math.min(N * TH - this.H + 40, this.cam.y))
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
    this.shake = Math.min(4, this.shake + k)
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
        const r = e.u!.infantry ? 5 : 9
        const cy = s.y - (e.u!.infantry ? 5 : 4)
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

  /** is an entity of another player drawn */
  shown(e: Ent): boolean {
    const g = this.game
    if (e.owner === 0) return true
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
    for (let a = 0; a < 360; a += 2) {
      const t = (a / 180) * Math.PI
      x.fillRect(Math.round(W / 2 - 0.5 + Math.cos(t) * rx), Math.round(H / 2 - 0.5 + Math.sin(t) * rx * 0.5), 1, 1)
    }
    this.rings.set(key, c)
    return c
  }

  private drawSprite(sp: Sprite, x: number, y: number) {
    this.ctx.drawImage(sp.cv, x - sp.ax, y - sp.ay)
  }

  draw(o: Overlay) {
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
    ctx.drawImage(T.cv, camX + T.ox, camY, this.W, this.H, 0, 0, this.W, this.H)

    // the tiles in view (with a margin for tall things)
    const c0 = unIso(camX - 40, camY - 60), c1 = unIso(camX + this.W + 40, camY - 60)
    const c2 = unIso(camX - 40, camY + this.H + 60), c3 = unIso(camX + this.W + 40, camY + this.H + 60)
    const tx0 = Math.max(0, Math.floor(Math.min(c0.x, c1.x, c2.x, c3.x)))
    const tx1 = Math.min(N - 1, Math.ceil(Math.max(c0.x, c1.x, c2.x, c3.x)))
    const ty0 = Math.max(0, Math.floor(Math.min(c0.y, c1.y, c2.y, c3.y)))
    const ty1 = Math.min(N - 1, Math.ceil(Math.max(c0.y, c1.y, c2.y, c3.y)))
    const onScreen = (x: number, y: number, m = 60) => {
      const s = scr(x, y)
      return s.x > -m && s.x < this.W + m && s.y > -m && s.y < this.H + m * 1.5
    }

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
          const k = e.z * 0.85
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
      if (e.dead || !onScreen(e.x, e.y)) continue
      const hover = o.hoverEnt === e
      if (!e.selected && !hover) continue
      if (e.owner !== 0 && !this.shown(e)) continue
      const col = e.owner === 0 ? (e.selected ? 0x7dff6a : 0xd8ffd0) : 0xff5a4a
      if (e.isB) continue
      {
        const s = scr(e.x, e.y)
        const r = e.u!.infantry ? 4 : Math.round(e.u!.radius * 22)
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
      const fade = w.t > 34 ? 1 - (w.t - 34) / 6 : 1
      list.push({
        k: w.x + w.y,
        f: () => {
          const p = scr(w.x, w.y)
          ctx.globalAlpha = fade
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
      if (e.dead || !onScreen(e.x, e.y, 90) || !this.shown(e)) continue
      if (e.air) {
        airList.push(e)
        continue
      }
      list.push({ k: e.x + e.y, f: () => this.drawEnt(e, scr) })
    }
    list.sort((a, b) => a.k - b.k)
    for (const d of list) d.f()
    airList.sort((a, b) => a.x + a.y - b.x - b.y)
    for (const e of airList) this.drawEnt(e, scr)

    // selected buildings get corner brackets on top
    for (const e of g.ents) {
      if (!e.isB || e.dead || (!e.selected && o.hoverEnt !== e) || !onScreen(e.x, e.y)) continue
      if (e.owner !== 0 && !this.shown(e)) continue
      const col = e.owner === 0 ? 0x7dff6a : 0xff5a4a
      this.footprint(scr, e.tx, e.ty, e.w, e.h, col, e.selected ? 0.9 : 0.5)
    }

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
          ctx.fillRect(q.x - 1, q.y, 2, 1)
          break
        case 'rocket':
        case 'mlrs':
          ctx.fillStyle = '#e8e2d0'
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
          ctx.fillStyle = '#ffd060'
          ctx.fillRect(q.x, q.y, 1, 1)
          break
        case 'art': {
          const gq = scr(p.x, p.y)
          ctx.fillStyle = 'rgba(0,0,0,0.3)'
          ctx.fillRect(gq.x - 1, gq.y, 2, 1)
          ctx.fillStyle = '#2a2a28'
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
          ctx.fillStyle = '#ffe6a0'
          ctx.fillRect(q.x, q.y - 1, 1, 1)
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
          const frames = A.explosions[Math.min(2, f.size)]
          const fr = frames[Math.min(frames.length - 1, Math.floor(k * frames.length))]
          if (k < 0.35) {
            ctx.globalCompositeOperation = 'lighter'
            ctx.globalAlpha = (0.35 - k) * 1.4
            const glow = A.smoke[Math.min(8, 4 + f.size * 2)]
            ctx.drawImage(glow.cv, q.x - glow.ax * 2, q.y - glow.ay * 2, glow.w * 2, glow.h * 2)
            ctx.globalCompositeOperation = 'source-over'
            ctx.globalAlpha = 1
          }
          this.drawSprite(fr, q.x, q.y - fr.h / 3)
          if (f.t < 0.05 && f.size >= 1) this.addShake(f.size * 0.8)
          break
        }
        case 'smoke':
        case 'dust': {
          const r = Math.min(8, Math.round(f.size + k * 3) - 1)
          const sp = A.smoke[Math.max(0, r)]
          ctx.globalAlpha = (1 - k) * (f.kind === 'dust' ? 0.45 : 0.7)
          if (f.kind === 'dust') ctx.filter = 'sepia(0.6)'
          this.drawSprite(sp, q.x, q.y)
          ctx.filter = 'none'
          ctx.globalAlpha = 1
          break
        }
        case 'fire': {
          const sp = A.fire[Math.floor(f.t * 14 + f.x * 7) % A.fire.length]
          this.drawSprite(sp, q.x, q.y)
          break
        }
        case 'flash':
          ctx.globalCompositeOperation = 'lighter'
          ctx.fillStyle = '#ffe8a0'
          ctx.fillRect(q.x - f.size, q.y - f.size, f.size * 2, f.size * 2)
          ctx.fillStyle = '#ffffff'
          ctx.fillRect(q.x - 1, q.y - 1, 2, 2)
          ctx.globalCompositeOperation = 'source-over'
          break
        case 'spark':
          ctx.fillStyle = k < 0.5 ? '#fff0a0' : '#ff9a40'
          ctx.fillRect(q.x + Math.round(Math.sin(f.t * 40) * 2), q.y - Math.round(k * 3), 1, 1)
          ctx.fillRect(q.x - Math.round(Math.cos(f.t * 37) * 2), q.y - Math.round(k * 2), 1, 1)
          break
        case 'debris':
          ctx.fillStyle = k < 0.3 ? '#ffb050' : '#2a2622'
          ctx.fillRect(q.x, q.y, 2, 1)
          break
      }
    }

    // health bars
    for (const e of g.ents) {
      if (e.dead || !onScreen(e.x, e.y)) continue
      const show = e.selected || o.hoverEnt === e || (e.hp < e.maxHp && g.time - e.lastHit < 3)
      if (!show || !this.shown(e)) continue
      const k = Math.max(0, e.hp / e.maxHp)
      let w: number, x: number, y: number
      if (e.isB) {
        const art = A.buildings[g.players[e.owner].faction][e.key]
        const s = scr(e.x, e.y)
        w = e.w * 12
        x = s.x - w / 2
        y = s.y - art.body.ay + 2
      } else {
        const s = scr(e.x, e.y, e.z)
        w = e.u!.infantry ? 8 : 14
        x = s.x - w / 2
        y = s.y - (e.u!.infantry ? 15 : e.air ? 22 : 16)
      }
      ctx.fillStyle = '#0c0e0a'
      ctx.fillRect(Math.round(x) - 1, Math.round(y) - 1, w + 2, 4)
      ctx.fillStyle = k > 0.6 ? '#5fd65a' : k > 0.3 ? '#e8c03a' : '#e2492f'
      ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w * k)), 2)
      // a harvester shows its load
      if (e.u?.harvester && e.owner === 0) {
        ctx.fillStyle = '#0c0e0a'
        ctx.fillRect(Math.round(x) - 1, Math.round(y) + 3, w + 2, 2)
        ctx.fillStyle = '#e0b532'
        ctx.fillRect(Math.round(x), Math.round(y) + 3, Math.round((w * e.cargo) / HARVEST_LOAD), 1)
      }
    }

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

    // rally points of selected buildings
    for (const e of g.ents) {
      if (!e.selected || !e.isB || !e.rally || e.owner !== 0) continue
      const a = scr(e.x, e.y), b = scr(e.rally.x, e.rally.y)
      this.dashed(a.x, a.y, b.x, b.y, '#9cff8a')
      ctx.fillStyle = '#9cff8a'
      ctx.fillRect(b.x - 1, b.y - 6, 1, 6)
      ctx.fillRect(b.x, b.y - 6, 3, 2)
    }
    // where a move order went
    if (o.moveMark) {
      const m = o.moveMark
      const k = Math.min(1, (g.time - m.t) / 0.5)
      if (k < 1) {
        const s = scr(m.x, m.y)
        const r = Math.round(7 * (1 - k)) + 2
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
    if (e.u!.infantry) {
      const fr = e.moving ? (Math.floor(e.anim * 7) % 2 ? art.alt! : art.alt2!) : art.hull
      this.drawSprite(fr.at(e.dir), s.x, s.y)
      return
    }
    const hull = e.u!.harvester && e.cargo > 0 && art.alt ? art.alt : art.hull
    // a little bounce while driving
    const bob = e.moving && !e.air && Math.floor(e.anim * 8) % 2 ? -1 : 0
    this.drawSprite(hull.at(e.dir), s.x, s.y + bob)
    if (art.turret) {
      const [dx, dy] = mountOffset(art.mount, e.dir)
      this.drawSprite(art.turret.at(e.tdir), s.x + dx, s.y + dy + bob)
    }
    if (art.rotor) {
      // two blades turning fast, with a faint blur disc
      const [dx, dy] = mountOffset([0, 0, art.rotor.z], e.dir)
      const cx = s.x + dx, cy = s.y + dy
      const r = art.rotor.r
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

  private line(x0: number, y0: number, x1: number, y1: number, col: string) {
    const ctx = this.ctx
    ctx.fillStyle = col
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1)
  }

  private dashed(x0: number, y0: number, x1: number, y1: number, col: string) {
    const ctx = this.ctx
    ctx.fillStyle = col
    const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1)
    for (let i = 0; i <= n; i++) if ((i >> 2) % 2 === 0) ctx.fillRect(Math.round(x0 + ((x1 - x0) * i) / n), Math.round(y0 + ((y1 - y0) * i) / n), 1, 1)
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
      this.line(p.x, p.y, Math.round(p.x + (q.x - p.x) * k), Math.round(p.y + (q.y - p.y) * k), cs)
      this.line(q.x, q.y, Math.round(q.x + (p.x - q.x) * k), Math.round(q.y + (p.y - q.y) * k), cs)
    }
    seg(a, b)
    seg(b, c)
    seg(c, d)
    seg(d, a)
    this.ctx.globalAlpha = 1
  }
}
