// Mouse and keyboard: select with a click or a dragged frame, command with the right button,
// move the view with the arrow keys, the screen edges or the middle button.

import type { Game, Ent } from './game'
import type { Renderer, Overlay } from './render'
import { Ter } from './map'

export class Input {
  sel: Ent[] = []
  groups = new Map<number, number[]>()
  place: string | null = null
  attackMode = false
  overlay: Overlay = {}
  mouse = { x: 0, y: 0, inside: false }
  private down: { x: number; y: number; btn: number } | null = null
  private pan: { x: number; y: number; cx: number; cy: number } | null = null
  private keys = new Set<string>()
  private lastClick = { t: 0, id: 0 }
  private lastGroup = { n: -1, t: 0 }
  paused = false
  onChange: () => void = () => {}
  onPause: () => void = () => {}

  constructor(public game: Game, public r: Renderer, public el: HTMLCanvasElement, public scale: () => number, signal: AbortSignal) {
    const o = { signal }
    el.addEventListener('contextmenu', (e) => e.preventDefault(), o)
    el.addEventListener('mousedown', (e) => this.onDown(e), o)
    window.addEventListener('mousemove', (e) => this.onMove(e), o)
    window.addEventListener('mouseup', (e) => this.onUp(e), o)
    el.addEventListener('mouseleave', () => (this.mouse.inside = false), o)
    document.addEventListener('mouseleave', () => (this.mouse.inside = false), o)
    window.addEventListener('keydown', (e) => this.onKey(e, true), o)
    window.addEventListener('keyup', (e) => this.onKey(e, false), o)
    window.addEventListener('blur', () => this.keys.clear(), o)
  }

  private local(e: MouseEvent) {
    const b = this.el.getBoundingClientRect()
    const s = this.scale()
    return { x: Math.floor((e.clientX - b.left) / s), y: Math.floor((e.clientY - b.top) / s) }
  }

  private onDown(e: MouseEvent) {
    const p = this.local(e)
    this.mouse.inside = true
    if (e.button === 1) {
      e.preventDefault()
      this.pan = { x: e.clientX, y: e.clientY, cx: this.r.cam.x, cy: this.r.cam.y }
      return
    }
    if (this.paused) return
    if (e.button === 2) {
      if (this.place || this.attackMode) {
        this.place = null
        this.attackMode = false
        this.onChange()
        return
      }
      this.command(p.x, p.y)
      return
    }
    if (e.button === 0) {
      if (this.place) {
        const w = this.placeTile(p.x, p.y)
        if (this.game.placeReady(0, w.tx, w.ty)) {
          this.place = null
          this.onChange()
        }
        return
      }
      if (this.attackMode) {
        const w = this.r.toWorld(p.x, p.y)
        const hit = this.r.pick(p.x, p.y)
        const units = this.sel.filter((u) => !u.isB && u.owner === 0)
        if (hit && hit.owner !== 0) this.game.commandAttack(units, hit)
        else this.game.commandMove(units, w.x, w.y, true)
        this.overlay.moveMark = { x: w.x, y: w.y, t: this.game.time, attack: true }
        this.attackMode = e.shiftKey
        this.onChange()
        return
      }
      this.down = { x: p.x, y: p.y, btn: 0 }
    }
  }

  private onMove(e: MouseEvent) {
    if (this.pan) {
      const s = this.scale()
      this.r.cam.x = this.pan.cx - (e.clientX - this.pan.x) / s
      this.r.cam.y = this.pan.cy - (e.clientY - this.pan.y) / s
      this.r.clampCam()
      return
    }
    const p = this.local(e)
    this.mouse.x = p.x
    this.mouse.y = p.y
    const b = this.el.getBoundingClientRect()
    const wrap = this.el.parentElement!.getBoundingClientRect()
    this.mouse.inside = e.clientX >= b.left && e.clientY >= b.top && e.clientX < Math.min(b.right, wrap.right) && e.clientY < Math.min(b.bottom, wrap.bottom)
    if (this.down) {
      if (Math.abs(p.x - this.down.x) + Math.abs(p.y - this.down.y) > 3) this.overlay.box = { x0: this.down.x, y0: this.down.y, x1: p.x, y1: p.y }
    }
  }

  private onUp(e: MouseEvent) {
    if (e.button === 1) {
      this.pan = null
      return
    }
    if (e.button !== 0 || !this.down) return
    const p = this.local(e)
    const box = this.overlay.box
    this.overlay.box = undefined
    this.down = null
    const g = this.game
    if (box) {
      const x0 = Math.min(box.x0, box.x1), x1 = Math.max(box.x0, box.x1)
      const y0 = Math.min(box.y0, box.y1), y1 = Math.max(box.y0, box.y1)
      const picked = g.ents.filter((u) => {
        if (u.isB || u.dead || u.owner !== 0) return false
        const s = this.r.toScreen(u.x, u.y, u.z)
        return s.x >= x0 && s.x <= x1 && s.y - 4 >= y0 && s.y - 4 <= y1
      })
      if (e.shiftKey) this.setSel([...new Set([...this.sel, ...picked])])
      else this.setSel(picked)
      return
    }
    const hit = this.r.pick(p.x, p.y)
    if (!hit) {
      if (!e.shiftKey) this.setSel([])
      return
    }
    // double click: all of that kind in view
    const now = performance.now()
    if (hit.owner === 0 && !hit.isB && this.lastClick.id === hit.id && now - this.lastClick.t < 350) {
      const same = g.ents.filter((u) => {
        if (u.dead || u.owner !== 0 || u.key !== hit.key || u.isB) return false
        const s = this.r.toScreen(u.x, u.y)
        return s.x >= 0 && s.y >= 0 && s.x < this.r.W && s.y < this.r.H
      })
      this.setSel(same)
      return
    }
    this.lastClick = { t: now, id: hit.id }
    if (e.shiftKey && hit.owner === 0 && !hit.isB) {
      if (this.sel.includes(hit)) this.setSel(this.sel.filter((s) => s !== hit))
      else this.setSel([...this.sel.filter((s) => !s.isB && s.owner === 0), hit])
    } else this.setSel([hit])
  }

  setSel(list: Ent[]) {
    for (const s of this.sel) s.selected = false
    this.sel = list.filter((e) => !e.dead)
    for (const s of this.sel) s.selected = true
    this.onChange()
  }

  /** the top corner tile of a building being placed under the mouse */
  placeTile(px: number, py: number): { tx: number; ty: number } {
    const def = this.game.bdefs[this.place!]
    const w = this.r.toWorld(px, py)
    return { tx: Math.round(w.x - def.w / 2), ty: Math.round(w.y - def.h / 2) }
  }

  /** what a right click means here */
  private command(px: number, py: number) {
    const g = this.game
    const mine = this.sel.filter((e) => !e.dead && e.owner === 0)
    if (!mine.length) return
    const w = this.r.toWorld(px, py)
    const hit = this.r.pick(px, py)
    const units = mine.filter((e) => !e.isB)
    const blds = mine.filter((e) => e.isB)
    if (!units.length) {
      // buildings: a rally point
      for (const b of blds) if (b.b!.produces && b.b!.produces !== 'build') b.rally = { x: w.x, y: w.y }
      this.overlay.moveMark = { x: w.x, y: w.y, t: g.time, attack: false }
      return
    }
    if (hit && hit.owner !== 0) {
      const can = units.filter((u) => g.canHit(u, hit))
      g.commandAttack(can, hit)
      const rest = units.filter((u) => !can.includes(u))
      if (rest.length) g.commandMove(rest, hit.x, hit.y, false)
      this.overlay.moveMark = { x: hit.x, y: hit.y, t: g.time, attack: true }
      g.onSound('ack', 0, 0)
      return
    }
    const harv = units.filter((u) => u.u!.harvester)
    let others = units.filter((u) => !u.u!.harvester)
    if (harv.length) {
      const tx = Math.floor(w.x), ty = Math.floor(w.y)
      const i = g.map.inMap(tx, ty) ? g.map.idx(tx, ty) : -1
      if (hit && hit.owner === 0 && hit.key === 'ref') g.commandReturn(harv)
      else if (i >= 0 && g.map.ter[i] === Ter.Ore && g.map.ore[i] > 0) g.commandHarvest(harv, i)
      else others = units
    }
    if (others.length) g.commandMove(others, w.x, w.y, false)
    this.overlay.moveMark = { x: w.x, y: w.y, t: g.time, attack: false }
    g.onSound('ack', 0, 0)
  }

  private onKey(e: KeyboardEvent, down: boolean) {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return
    const k = e.key
    if (down) this.keys.add(k)
    else this.keys.delete(k)
    if (!down) return
    const g = this.game
    if (k === 'p' || k === 'P' || k === 'F10') {
      this.onPause()
      e.preventDefault()
      return
    }
    if (this.paused) return
    if (k === 'Escape') {
      if (this.place || this.attackMode) {
        this.place = null
        this.attackMode = false
      } else this.setSel([])
      this.onChange()
      return
    }
    if (/^[0-9]$/.test(k)) {
      const n = +k
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault()
        this.groups.set(n, this.sel.filter((s) => s.owner === 0).map((s) => s.id))
        g.msg(`Gruppe ${n} gebildet`)
        return
      }
      const ids = this.groups.get(n)
      if (!ids) return
      const list = ids.map((id) => g.byId.get(id)).filter((x): x is Ent => !!x && !x.dead)
      this.setSel(list)
      const now = performance.now()
      if (this.lastGroup.n === n && now - this.lastGroup.t < 400 && list.length) this.r.lookAt(list[0].x, list[0].y)
      this.lastGroup = { n, t: now }
      return
    }
    switch (k.toLowerCase()) {
      case 'a':
        if (this.sel.some((s) => !s.isB && s.owner === 0 && s.weapon)) {
          this.attackMode = true
          this.onChange()
        }
        break
      case 's':
        g.commandStop(this.sel.filter((s) => s.owner === 0))
        break
      case 'h': {
        const hq = g.ents.find((e) => e.owner === 0 && e.key === 'hq') ?? g.ents.find((e) => e.owner === 0 && e.isB)
        if (hq) this.r.lookAt(hq.x, hq.y)
        break
      }
      case ' ':
        e.preventDefault()
        if (this.sel.length) this.r.lookAt(this.sel[0].x, this.sel[0].y)
        break
      case 'e': {
        // everything that fights, in view
        const army = g.ents.filter((u) => {
          if (u.dead || u.owner !== 0 || u.isB || !u.weapon) return false
          const s = this.r.toScreen(u.x, u.y)
          return s.x >= 0 && s.y >= 0 && s.x < this.r.W && s.y < this.r.H
        })
        this.setSel(army)
        break
      }
      case 'q': {
        const army = g.ents.filter((u) => !u.dead && u.owner === 0 && !u.isB && u.weapon)
        this.setSel(army)
        break
      }
    }
  }

  /** move the view with keys and screen edges */
  scroll(dt: number) {
    const sp = 520 * dt / Math.max(1, this.scale() / 2)
    let dx = 0, dy = 0
    if (this.keys.has('ArrowLeft')) dx -= sp
    if (this.keys.has('ArrowRight')) dx += sp
    if (this.keys.has('ArrowUp')) dy -= sp
    if (this.keys.has('ArrowDown')) dy += sp
    if (this.mouse.inside && !this.down && !this.pan && document.hasFocus()) {
      const m = 4
      if (this.mouse.x <= m) dx -= sp
      const wrap = this.el.parentElement!
      const s = this.scale()
      if (this.mouse.x >= wrap.clientWidth / s - m - 1) dx += sp
      if (this.mouse.y <= m) dy -= sp
      if (this.mouse.y >= wrap.clientHeight / s - m - 1) dy += sp
    }
    if (dx || dy) {
      this.r.cam.x += dx
      this.r.cam.y += dy
      this.r.clampCam()
    }
  }

  /** hover feedback and the building ghost */
  frame() {
    const g = this.game
    this.sel = this.sel.filter((s) => !s.dead)
    const p = this.mouse
    this.overlay.hoverEnt = p.inside && !this.overlay.box ? this.r.pick(p.x, p.y) : null
    if (this.place) {
      const t = this.placeTile(p.x, p.y)
      this.overlay.place = { key: this.place, tx: t.tx, ty: t.ty, ok: g.canPlace(0, this.place, t.tx, t.ty) }
    } else this.overlay.place = undefined
    // the cursor says what a click will do
    let cur = 'default'
    const h = this.overlay.hoverEnt
    const mine = this.sel.some((s) => !s.isB && s.owner === 0)
    if (this.place) cur = 'cell'
    else if (this.attackMode) cur = 'crosshair'
    else if (h && h.owner !== 0 && mine) cur = 'crosshair'
    else if (h) cur = 'pointer'
    else if (mine) {
      const w = this.r.toWorld(p.x, p.y)
      const tx = Math.floor(w.x), ty = Math.floor(w.y)
      if (this.sel.some((s) => s.u?.harvester) && g.map.inMap(tx, ty) && g.map.ore[g.map.idx(tx, ty)] > 0) cur = 'copy'
      else cur = g.map.walk(tx, ty) ? 'move' : 'not-allowed'
    }
    if (this.el.style.cursor !== cur) this.el.style.cursor = cur
  }
}
