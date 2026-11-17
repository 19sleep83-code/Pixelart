// The command bar on the right: money and power, the minimap, the build menus and what is selected.

import type { Game, Ent } from '../game/game'
import type { Assets } from '../game/assets'
import type { Renderer } from '../game/render'
import type { Input } from '../game/input'
import type { Terrain } from '../game/terrain'
import { BUILD_ORDER, UNIT_ORDER, HARVEST_LOAD, type Queue } from '../game/defs'
import { TW, TH } from '../core/iso'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const TAB_OF_UNIT: Record<string, Queue> = { rifle: 'inf', at: 'inf', harv: 'veh', ifv: 'veh', mbt: 'veh', aa: 'veh', art: 'veh', heli: 'air' }

interface Btn {
  el: HTMLButtonElement
  key: string
  q: Queue
  bar: HTMLDivElement
  badge: HTMLSpanElement
  state: HTMLSpanElement
}

export class Hud {
  tab: Queue = 'build'
  private btns: Btn[] = []
  private icons = new Map<string, string>()
  private selKey = '-'
  private miniCtx: CanvasRenderingContext2D
  private mini: HTMLCanvasElement
  private tick = 0
  private msgKey = ''

  constructor(public g: Game, public A: Assets, public r: Renderer, public input: Input, public terrain: Terrain, signal: AbortSignal) {
    const f = g.me.faction
    for (const k of ['hq', ...BUILD_ORDER]) this.icons.set('b:' + k, A.buildings[f][k].icon.toDataURL())
    for (const k of UNIT_ORDER) this.icons.set('u:' + k, A.units[f][k].icon.toDataURL())
    this.mini = $('mini')
    this.miniCtx = this.mini.getContext('2d')!
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      b.onclick = () => this.setTab(b.dataset.tab as Queue)
    })
    this.setTab('build')
    // the minimap moves the view
    let drag = false
    const go = (e: MouseEvent) => {
      const b = this.mini.getBoundingClientRect()
      const mx = ((e.clientX - b.left) / b.width) * this.mini.width
      const my = ((e.clientY - b.top) / b.height) * this.mini.height
      const sx = (mx / this.mini.width) * terrain.cv.width - terrain.ox
      const sy = (my / this.mini.height) * terrain.cv.height
      const w = { x: (sx / (TW / 2) + sy / (TH / 2)) / 2, y: (sy / (TH / 2) - sx / (TW / 2)) / 2 }
      if (e.button === 2 || e.buttons === 2) {
        const units = input.sel.filter((u) => !u.isB && u.owner === 0)
        if (units.length) g.commandMove(units, w.x, w.y, false)
        return
      }
      r.lookAt(w.x, w.y)
    }
    this.mini.addEventListener('mousedown', (e) => {
      drag = e.button === 0
      go(e)
    }, { signal })
    this.mini.addEventListener('contextmenu', (e) => e.preventDefault(), { signal })
    window.addEventListener('mousemove', (e) => drag && go(e), { signal })
    window.addEventListener('mouseup', () => (drag = false), { signal })
    input.onChange = () => {
      this.selKey = '-'
      this.update(true)
    }
  }

  setTab(t: Queue) {
    this.tab = t
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t))
    const grid = $('grid')
    grid.innerHTML = ''
    this.btns = []
    const keys = t === 'build' ? BUILD_ORDER : UNIT_ORDER.filter((k) => TAB_OF_UNIT[k] === t)
    for (const key of keys) {
      const el = document.createElement('button')
      el.className = 'item'
      const img = document.createElement('img')
      img.src = this.icons.get((t === 'build' ? 'b:' : 'u:') + key)!
      img.draggable = false
      const def = t === 'build' ? this.g.bdefs[key] : this.g.me.units[key]
      const name = document.createElement('span')
      name.className = 'name'
      name.textContent = def.name
      const cost = document.createElement('span')
      cost.className = 'cost'
      cost.textContent = String(def.cost)
      const bar = document.createElement('div')
      bar.className = 'prog'
      const badge = document.createElement('span')
      badge.className = 'badge'
      const state = document.createElement('span')
      state.className = 'state'
      el.append(img, name, cost, bar, badge, state)
      el.onclick = () => this.click(key, t)
      el.oncontextmenu = (e) => {
        e.preventDefault()
        this.g.cancelItem(0, t, key)
        if (this.input.place === key) this.input.place = null
        this.update(true)
      }
      el.onmouseenter = () => this.tip(def.name, def.desc, def.cost, this.g.missing(0, def.req))
      el.onmouseleave = () => this.tip()
      grid.append(el)
      this.btns.push({ el, key, q: t, bar, badge, state })
    }
    this.update(true)
  }

  private tip(name?: string, desc?: string, cost?: number, missing?: string[]) {
    const t = $('tip')
    if (!name) {
      t.style.display = 'none'
      return
    }
    t.style.display = 'block'
    const need = missing && missing.length ? `<div class="need">Benötigt: ${missing.map((k) => this.g.bdefs[k]?.name ?? k).join(', ')}</div>` : ''
    t.innerHTML = `<b>${name}</b> <span class="c">${cost}</span><div>${desc}</div>${need}`
  }

  private click(key: string, q: Queue) {
    const g = this.g
    if (q === 'build') {
      const it = g.me.queues.build[0]
      if (it && it.ready && it.key === key) {
        this.input.place = key
        this.input.attackMode = false
      } else if (!it) g.queueItem(0, 'build', key)
      else g.msg('Es wird schon gebaut', 'warn')
    } else if (!g.queueItem(0, q, key)) {
      const def = g.me.units[key]
      const miss = g.missing(0, def.req)
      if (miss.length) g.msg(`Benötigt: ${miss.map((k) => g.bdefs[k].name).join(', ')}`, 'warn')
    }
    this.update(true)
  }

  update(force = false) {
    this.tick++
    if (!force && this.tick % 6) return
    const g = this.g
    const me = g.me
    $('credits').textContent = String(Math.floor(me.credits))
    const max = Math.max(me.powerProd, me.powerUse, 100)
    $('powerfill').style.width = `${(me.powerProd / max) * 100}%`
    const use = $('poweruse')
    use.style.left = `${Math.min(100, (me.powerUse / max) * 100)}%`
    const low = me.powerUse > me.powerProd
    $('powertext').textContent = `${me.powerUse}/${me.powerProd}`
    $('powertext').classList.toggle('low', low)
    const t = Math.floor(g.time)
    $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    // which tabs have a producer
    const has: Record<Queue, boolean> = {
      build: g.hasBuilding(0, 'hq'),
      inf: g.hasBuilding(0, 'barracks'),
      veh: g.hasBuilding(0, 'factory'),
      air: g.hasBuilding(0, 'helipad'),
    }
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      const q = b.dataset.tab as Queue
      b.classList.toggle('off', !has[q])
      const it = me.queues[q][0]
      b.classList.toggle('ready', q === 'build' && !!it?.ready)
      b.classList.toggle('busy', !!it && !it.ready)
    })
    for (const b of this.btns) {
      const def = b.q === 'build' ? g.bdefs[b.key] : me.units[b.key]
      const miss = g.missing(0, def.req)
      const list = me.queues[b.q]
      const mine = list.filter((i) => i.key === b.key)
      const head = list[0]
      const active = head && head.key === b.key
      b.el.classList.toggle('locked', miss.length > 0 || !has[b.q])
      b.el.classList.toggle('poor', me.credits < 1 && !active)
      const prog = active ? head.progress : 0
      b.bar.style.height = `${(1 - prog) * 100}%`
      b.bar.style.display = active && !head.ready ? 'block' : 'none'
      b.badge.textContent = mine.length > 1 ? String(mine.length) : ''
      b.state.textContent = active && head.ready ? 'Bereit' : miss.length ? '' : b.q === 'build' && head && !active ? '' : ''
      b.el.classList.toggle('isready', !!(active && head.ready))
      b.el.classList.toggle('placing', this.input.place === b.key)
      b.el.classList.toggle('dim', b.q === 'build' && !!head && !active)
    }
    this.selection()
    this.messages()
  }

  private messages() {
    const g = this.g
    const key = g.msgs.map((m) => m.t + m.text).join('|') + Math.floor(g.time)
    if (key === this.msgKey) return
    this.msgKey = key
    const el = $('msgs')
    el.innerHTML = ''
    for (const m of g.msgs) {
      const age = g.time - m.t
      if (age > 8) continue
      const d = document.createElement('div')
      d.className = 'msg ' + m.kind
      d.style.opacity = String(Math.min(1, (8 - age) / 2))
      d.textContent = m.text
      el.append(d)
    }
  }

  private selection() {
    const g = this.g
    const sel = this.input.sel.filter((e) => !e.dead)
    const el = $('sel')
    const key = sel.map((e) => e.id).join(',')
    if (key !== this.selKey) {
      this.selKey = key
      el.innerHTML = ''
      if (!sel.length) {
        el.innerHTML = '<div class="hint">Linksklick oder Rahmen ziehen: auswählen<br>Rechtsklick: bewegen / angreifen<br>A: Angriffsbewegung · S: Stopp<br>Strg+1–9: Gruppe · H: Hauptquartier</div>'
        return
      }
      if (sel.length === 1) {
        const e = sel[0]
        const f = g.players[e.owner].faction
        const icon = e.isB ? this.A.buildings[f][e.key].icon : this.A.units[f][e.key].icon
        const name = e.isB ? e.b!.name : e.u!.name
        el.innerHTML = `<div class="one"><img src="${icon.toDataURL()}"><div><div class="nm">${name}${e.owner !== 0 ? ' <span class="foe">(Feind)</span>' : ''}</div><div class="hp"><div></div></div><div class="hpt"></div><div class="extra"></div></div></div>`
        if (e.owner === 0 && e.isB) {
          const row = document.createElement('div')
          row.className = 'acts'
          if (e.key !== 'hq') {
            const sell = document.createElement('button')
            sell.textContent = `Verkaufen (+${Math.round(e.b!.cost * 0.5 * e.hp / e.maxHp)})`
            sell.onclick = () => {
              g.sell(e)
              this.input.setSel([])
            }
            row.append(sell)
          }
          const rep = document.createElement('button')
          rep.textContent = 'Reparieren'
          rep.className = 'rep'
          rep.onclick = () => {
            e.repairing = !e.repairing
            rep.classList.toggle('on', e.repairing)
          }
          rep.classList.toggle('on', e.repairing)
          row.append(rep)
          const q = e.b!.produces
          if (q && q !== 'build') {
            const prim = document.createElement('button')
            prim.textContent = 'Hauptgebäude'
            prim.title = 'Neue Einheiten kommen hier heraus'
            prim.classList.toggle('on', g.me.primary[q] === e.id)
            prim.onclick = () => {
              g.me.primary[q] = e.id
              prim.classList.add('on')
            }
            row.append(prim)
          }
          el.append(row)
        }
      } else {
        const counts = new Map<string, Ent[]>()
        for (const e of sel) {
          const k = (e.isB ? 'b:' : 'u:') + e.key
          if (!counts.has(k)) counts.set(k, [])
          counts.get(k)!.push(e)
        }
        const wrap = document.createElement('div')
        wrap.className = 'many'
        for (const [k, list] of counts) {
          const b = document.createElement('button')
          const src = this.icons.get(k) ?? ''
          b.innerHTML = `<img src="${src}"><span>${list.length}</span>`
          b.title = list[0].isB ? list[0].b!.name : list[0].u!.name
          b.onclick = (ev) => this.input.setSel(ev.shiftKey ? sel.filter((s) => !list.includes(s)) : list)
          wrap.append(b)
        }
        el.append(wrap)
      }
    }
    if (sel.length === 1) {
      const e = sel[0]
      const k = Math.max(0, e.hp / e.maxHp)
      const bar = el.querySelector<HTMLDivElement>('.hp div')
      if (bar) {
        bar.style.width = `${k * 100}%`
        bar.style.background = k > 0.6 ? '#5fd65a' : k > 0.3 ? '#e8c03a' : '#e2492f'
      }
      const t = el.querySelector('.hpt')
      if (t) t.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}`
      const x = el.querySelector('.extra')
      if (x) {
        if (e.u?.harvester) x.textContent = `Ladung: ${Math.floor(e.cargo)} / ${HARVEST_LOAD}`
        else if (e.weapon) x.textContent = `Reichweite ${e.weapon.range}` + (e.weapon.air ? ' · trifft Luft' : '')
        else x.textContent = ''
      }
    }
  }

  drawMini() {
    const g = this.g
    const c = this.miniCtx
    const W = this.mini.width, H = this.mini.height
    const T = this.terrain
    c.imageSmoothingEnabled = false
    c.drawImage(T.miniMap(W, H), 0, 0)
    const kx = W / T.cv.width, ky = H / T.cv.height
    const pt = (x: number, y: number) => [((x - y) * (TW / 2) + T.ox) * kx, (x + y) * (TH / 2) * ky]
    for (const e of g.ents) {
      if (e.dead || !this.r.shown(e)) continue
      const [x, y] = pt(e.x, e.y)
      const own = e.owner === 0
      c.fillStyle = own ? (e.selected ? '#ffffff' : '#7dff6a') : '#ff4a3a'
      const s = e.isB ? Math.max(2, e.w * 1.6) : 2
      c.fillRect(Math.round(x - s / 2), Math.round(y - s / 4), s, Math.max(1, s / 2) + (e.isB ? 0 : 0))
    }
    // fog
    c.save()
    c.imageSmoothingEnabled = true
    c.setTransform((TW / 2) * kx, (TH / 2) * ky, -(TW / 2) * kx, (TH / 2) * ky, T.ox * kx, 0)
    c.drawImage(this.r.fogCv, 0, 0)
    c.restore()
    // the view
    const x0 = (this.r.cam.x + T.ox) * kx, y0 = this.r.cam.y * ky
    c.strokeStyle = '#f2e6a8'
    c.lineWidth = 1
    c.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(this.r.W * kx), Math.round(this.r.H * ky))
  }
}
