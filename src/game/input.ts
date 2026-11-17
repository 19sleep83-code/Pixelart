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
  /** keys the command bar handles (production, tabs); returns true if used */
  onHotkey: (e: KeyboardEvent) => boolean = () => false
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
        if (u.isB || u.dead || u.owner !== 0 || u.carriedBy || u.inside) return false
        const s = this.r.toScreen(u.x, u.y, u.z)
        return s.x >= x0 && s.x <= x1 && s.y - 4 >= y0 && s.y - 4 <= y1
      })
      if (e.shiftKey) this.setSel([...new Set([...this.sel, ...picked])])
      else this.setSel(picked)
      return
    }
    const hit = this.r.pick(p.x, p.y)
    if (!hit) {
      // a house of ours: the soldiers inside
      const hg = this.r.pickGarrison(p.x, p.y)
      if (hg && hg.owner === 0 && hg.occ.length) {
        this.setSel(e.shiftKey ? [...new Set([...this.sel.filter((s) => !s.isB), ...hg.occ])] : [...hg.occ])
        return
      }
      if (!e.shiftKey) this.setSel([])
      return
    }
    // a bunker clicked twice: its crew
    if (hit.isB && hit.owner === 0 && this.lastClick.id === hit.id && performance.now() - this.lastClick.t < 350) {
      const hg = this.game.garrisonOf(hit)
      if (hg && hg.occ.length) {
        this.setSel([...hg.occ])
        return
      }
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
    // engineers take over enemy buildings
    const eng = units.filter((u) => u.u!.engineer)
    if (hit && hit.isB && hit.owner !== 0 && eng.length) {
      g.commandCapture(eng, hit)
      const rest = units.filter((u) => !u.u!.engineer)
      const can = rest.filter((u) => g.canHit(u, hit) || u.jet)
      g.commandAttack(can, hit)
      const walk = rest.filter((u) => !can.includes(u))
      if (walk.length) g.commandMove(walk, hit.x, hit.y, false)
      this.overlay.moveMark = { x: hit.x, y: hit.y, t: g.time, attack: false }
      g.onSound('ack', 0, 0)
      return
    }
    // soldiers into a house, or into one of our bunkers
    const hg = !hit || (hit.isB && hit.owner === 0) ? this.r.pickGarrison(px, py) : null
    if (hg) {
      const inf = units.filter((u) => u.u!.infantry && !u.u!.engineer)
      if (hg.occ.length && hg.owner !== 0) {
        // the enemy is in there: fire on the house
        const t = hg.occ[0]
        const can = units.filter((u) => g.canHit(u, t) || u.jet)
        g.commandAttack(can, t)
        this.overlay.moveMark = { x: hg.x, y: hg.y, t: g.time, attack: true }
        g.onSound('ack', 0, 0)
        return
      }
      if (inf.length && g.canEnter(0, hg)) {
        g.commandGarrison(inf, hg)
        const rest = units.filter((u) => !inf.includes(u))
        if (rest.length) g.commandMove(rest, hg.x, hg.y + 1.5, false)
        this.overlay.moveMark = { x: hg.x, y: hg.y, t: g.time, attack: false }
        g.onSound('ack', 0, 0)
        return
      }
      if (inf.length && hg.occ.length >= hg.cap) g.msg(`${hg.name} ist voll`, 'warn')
    }
    // ground troops onto our landing ship
    if (hit && hit.owner === 0 && hit.u?.transport) {
      const troops = units.filter((u) => !u.air && !u.naval)
      if (troops.length) {
        g.commandBoard(troops, hit)
        this.overlay.moveMark = { x: hit.x, y: hit.y, t: g.time, attack: false }
        g.onSound('ack', 0, 0)
        return
      }
    }
    if (hit && hit.owner !== 0) {
      const can = units.filter((u) => g.canHit(u, hit) || u.jet)
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
    if (!e.ctrlKey && !e.metaKey && !e.altKey && this.onHotkey(e)) {
      e.preventDefault()
      return
    }
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
      const list = ids.map((id) => g.byId.get(id)).filter((x): x is Ent => !!x && !x.dead && !x.carriedBy)
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
      case 'd': {
        for (const t of this.sel) if (t.owner === 0 && t.u?.transport) g.commandUnload(t)
        const out = this.sel.filter((t) => t.owner === 0 && t.inside)
        for (const b of this.sel) {
          const hg = b.isB && b.owner === 0 ? g.garrisonOf(b) : null
          if (hg) out.push(...hg.occ)
        }
        if (out.length) {
          g.commandExit(out)
          this.onChange()
        }
        break
      }
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
    const sp = (1040 * dt) / Math.max(1, this.scale())
    let dx = 0, dy = 0
    if (this.keys.has('ArrowLeft')) dx -= sp
    if (this.keys.has('ArrowRight')) dx += sp
    if (this.keys.has('ArrowUp')) dy -= sp
    if (this.keys.has('ArrowDown')) dy += sp
    if (this.mouse.inside && !this.down && !this.pan && document.hasFocus()) {
      const m = 8
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
    if (this.sel.some((s) => s.dead || s.carriedBy)) this.setSel(this.sel.filter((s) => !s.dead && !s.carriedBy))
    const p = this.mouse
    this.overlay.hoverEnt = p.inside && !this.overlay.box ? this.r.pick(p.x, p.y) : null
    const hb = this.overlay.hoverEnt
    this.overlay.hoverG = p.inside && !this.overlay.box && (!hb || (hb.isB && hb.owner === 0 && hb.key === 'bunker')) ? this.r.pickGarrison(p.x, p.y) : null
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
    else if (h && h.isB && h.owner !== 0 && this.sel.some((s) => s.u?.engineer)) cur = 'copy'
    else if (h && h.owner !== 0 && mine) cur = 'crosshair'
    else if (this.overlay.hoverG && this.overlay.hoverG.occ.length && this.overlay.hoverG.owner !== 0 && mine) cur = 'crosshair'
    else if (this.overlay.hoverG && this.sel.some((s) => s.u?.infantry && !s.u.engineer) && g.canEnter(0, this.overlay.hoverG)) cur = 'alias'
    else if (h && h.owner === 0 && h.u?.transport && this.sel.some((s) => !s.isB && !s.naval && !s.air)) cur = 'alias'
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
