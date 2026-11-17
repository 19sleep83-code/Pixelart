// The command bar on the right, styled like a field command post: money and power, the situation
// map, the build menus with hotkeys and data cards, the selection, and the radio log.

import type { Game, Ent } from '../game/game'
import type { Assets } from '../game/assets'
import type { Renderer } from '../game/render'
import type { Input } from '../game/input'
import type { Terrain } from '../game/terrain'
import { BUILD_ORDER, UNIT_ORDER, HARVEST_LOAD, ARMOR_NAME, RANK_NAME, RANKS, QUEUES, type Queue, type UnitDef, type BuildingDef, type WeaponDef } from '../game/defs'
import { TW, TH } from '../core/iso'

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T

const KEYS: [string, string][] = [
  ['KeyZ', 'Y'], ['KeyX', 'X'], ['KeyC', 'C'], ['KeyV', 'V'], ['KeyB', 'B'],
  ['KeyN', 'N'], ['KeyM', 'M'], ['Comma', ','], ['Period', '.'], ['Slash', '-'],
]
const TAB_KEYS: Record<string, Queue> = { F1: 'build', F2: 'inf', F3: 'veh', F4: 'air', F5: 'sea' }
const TAB_NAME: Record<Queue, string> = { build: 'Bau', inf: 'Infanterie', veh: 'Fahrzeuge', air: 'Luft', sea: 'See' }

interface Btn {
  el: HTMLButtonElement
  key: string
  q: Queue
  bar: HTMLDivElement
  badge: HTMLSpanElement
  state: HTMLSpanElement
}

const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!)

function targets(w: WeaponDef): string {
  const t: string[] = []
  if (w.ground) t.push('Boden')
  if (w.sea ?? w.ground) t.push('See')
  if (w.air) t.push('Luft')
  return t.join(' · ')
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
    $('side-name').textContent = f === 'nato' ? 'NATO' : 'Russland'
    $('side-name').className = 'side-chip ' + f
    this.mini = $('mini')
    this.miniCtx = this.mini.getContext('2d')!
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      b.onclick = () => this.setTab(b.dataset.tab as Queue)
    })
    // the sea tab only matters where there is water to sail
    const hasSea = g.map.type !== 'land'
    document.querySelector<HTMLButtonElement>('#tabs button[data-tab="sea"]')!.classList.toggle('nosea', !hasSea)
    this.setTab('build')
    // the situation map moves the view; a right click sends the selection there
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
    input.onHotkey = (e) => this.hotkey(e)
  }

  private hotkey(e: KeyboardEvent): boolean {
    if (TAB_KEYS[e.key]) {
      this.setTab(TAB_KEYS[e.key])
      return true
    }
    if (e.key === 'Tab') {
      const i = QUEUES.indexOf(this.tab)
      this.setTab(QUEUES[(i + (e.shiftKey ? QUEUES.length - 1 : 1)) % QUEUES.length])
      return true
    }
    const k = KEYS.findIndex(([code]) => code === e.code)
    if (k >= 0 && this.btns[k]) {
      this.click(this.btns[k].key, this.btns[k].q)
      return true
    }
    return false
  }

  setTab(t: Queue) {
    this.tab = t
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === t))
    const grid = $('grid')
    grid.innerHTML = ''
    this.btns = []
    const keys = t === 'build' ? BUILD_ORDER : UNIT_ORDER.filter((k) => this.g.me.units[k].queue === t)
    keys.forEach((key, i) => {
      const el = document.createElement('button')
      el.className = 'item'
      const img = document.createElement('img')
      img.src = this.icons.get((t === 'build' ? 'b:' : 'u:') + key)!
      img.alt = ''
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
      const kbd = document.createElement('kbd')
      kbd.textContent = KEYS[i]?.[1] ?? ''
      el.append(img, name, cost, bar, badge, state, kbd)
      el.onclick = () => this.click(key, t)
      el.oncontextmenu = (e) => {
        e.preventDefault()
        this.g.cancelItem(0, t, key)
        if (this.input.place === key) this.input.place = null
        this.update(true)
      }
      el.onmouseenter = () => this.card(def, t === 'build', el)
      el.onmouseleave = () => this.card()
      grid.append(el)
      this.btns.push({ el, key, q: t, bar, badge, state })
    })
    this.update(true)
  }

  /** the data card for a unit or building */
  private card(def?: UnitDef | BuildingDef, building = false, at?: HTMLElement) {
    const t = $('tip')
    if (!def) {
      t.style.display = 'none'
      return
    }
    const missing = this.g.missing(0, def.req)
    const rows: [string, string][] = [['Kosten', String(def.cost)], ['Bauzeit', `${def.time} s`], ['Struktur', String(def.hp)]]
    if (building) {
      const b = def as BuildingDef
      rows.push(['Fläche', `${b.w} × ${b.h} Felder`], ['Strom', b.power > 0 ? `+${b.power}` : String(b.power)])
    } else {
      const u = def as UnitDef
      rows.push(['Panzerung', ARMOR_NAME[u.armor]], ['Tempo', u.speed.toFixed(1)], ['Sicht', String(u.sight)])
      if (u.transport) rows.push(['Ladung', `${u.transport} Einheiten`])
      if (u.carrier) rows.push(['Jets an Bord', String(u.carrier)])
    }
    const w = def.weapon
    if (w) {
      rows.push(['Schaden', `${w.dmg}${w.burst && w.burst > 1 ? ' × ' + w.burst : ''}${w.splash ? ' (Fläche)' : ''}`])
      rows.push(['Reichweite', `${w.range}${w.minRange ? ' (min. ' + w.minRange + ')' : ''}`])
      rows.push(['Nachladen', `${w.reload} s`], ['Ziele', targets(w)])
    }
    const need = missing.length ? `<div class="need">Benötigt: ${missing.map((k) => esc(this.g.bdefs[k]?.name ?? k)).join(', ')}</div>` : ''
    t.innerHTML =
      `<div class="card-head"><span class="stencil">${esc(def.name)}</span></div>` +
      `<p>${esc(def.desc)}</p><dl>${rows.map(([k, v]) => `<dt>${k}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${need}`
    t.style.display = 'block'
    if (at) {
      const b = at.getBoundingClientRect()
      const side = $('side').getBoundingClientRect()
      t.style.top = `${Math.max(8, Math.min(window.innerHeight - t.offsetHeight - 8, b.top - 10))}px`
      t.style.right = `${window.innerWidth - side.left + 8}px`
    }
  }

  private click(key: string, q: Queue) {
    const g = this.g
    if (q === 'build') {
      const it = g.me.queues.build[0]
      if (it && it.ready && it.key === key) {
        this.input.place = key
        this.input.attackMode = false
      } else if (!it) {
        if (!g.queueItem(0, 'build', key)) this.need(g.bdefs[key].req)
      } else g.msg('Es wird schon ein Gebäude gebaut', 'warn')
    } else if (!g.queueItem(0, q, key)) this.need(g.me.units[key].req)
    this.update(true)
  }

  private need(req: string[]) {
    const miss = this.g.missing(0, req)
    if (miss.length) this.g.msg(`Benötigt: ${miss.map((k) => this.g.bdefs[k].name).join(', ')}`, 'warn')
  }

  update(force = false) {
    this.tick++
    if (!force && this.tick % 6) return
    const g = this.g
    const me = g.me
    $('credits').textContent = String(Math.floor(me.credits)).padStart(5, '0')
    const max = Math.max(me.powerProd, me.powerUse, 100)
    $('powerfill').style.width = `${(me.powerProd / max) * 100}%`
    $('poweruse').style.left = `${Math.min(100, (me.powerUse / max) * 100)}%`
    const low = me.powerUse > me.powerProd
    $('powertext').textContent = `${me.powerUse}/${me.powerProd}`
    $('powertext').classList.toggle('low', low)
    $('powerbar').classList.toggle('low', low)
    const t = Math.floor(g.time)
    $('clock').textContent = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
    $('count').textContent = `Einheiten ${g.ents.filter((e) => e.owner === 0 && !e.isB).length}`
    // which tabs have a producer
    const has = (q: Queue) =>
      q === 'build' ? g.hasBuilding(0, 'hq') : UNIT_ORDER.some((k) => me.units[k].queue === q && g.hasBuilding(0, me.units[k].producer))
    document.querySelectorAll<HTMLButtonElement>('#tabs button').forEach((b) => {
      const q = b.dataset.tab as Queue
      b.classList.toggle('off', !has(q))
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
      b.el.classList.toggle('locked', miss.length > 0)
      const prog = active ? head.progress : 0
      b.bar.style.height = `${(1 - prog) * 100}%`
      b.bar.style.display = active && !head.ready ? 'block' : 'none'
      b.badge.textContent = mine.length > 1 ? String(mine.length) : ''
      b.state.textContent = active && head.ready ? 'Bereit' : active ? `${Math.floor(prog * 100)}%` : ''
      b.el.classList.toggle('isready', !!(active && head.ready))
      b.el.classList.toggle('placing', this.input.place === b.key)
      b.el.classList.toggle('dim', b.q === 'build' && !!head && !active)
    }
    this.selection()
    this.radio()
  }

  private radio() {
    const g = this.g
    const key = g.msgs.map((m) => m.t + m.text).join('|') + Math.floor(g.time)
    if (key === this.msgKey) return
    this.msgKey = key
    const el = $('radio')
    el.innerHTML = ''
    for (const m of g.msgs) {
      const age = g.time - m.t
      if (age > 10) continue
      const t = Math.floor(m.t)
      const d = document.createElement('div')
      d.className = 'msg ' + m.kind
      d.style.opacity = String(Math.min(1, (10 - age) / 2.5))
      d.innerHTML = `<span class="ts">${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}</span><span class="ch">Funk</span>${esc(m.text)}`
      el.append(d)
    }
  }

  private rankHTML(e: Ent): string {
    if (!e.rank) return '<span class="rank r0">Rekrut</span>'
    const mark = e.rank >= 3 ? '★' : '^'.repeat(e.rank)
    return `<span class="rank r${e.rank}"><b>${mark}</b> ${RANK_NAME[e.rank]}</span>`
  }

  private selection() {
    const g = this.g
    const sel = this.input.sel.filter((e) => !e.dead && !e.carriedBy)
    const el = $('sel')
    const key = sel.map((e) => e.id).join(',')
    if (key !== this.selKey) {
      this.selKey = key
      el.innerHTML = ''
      if (!sel.length) {
        el.innerHTML =
          '<div class="stencil sel-title">Auswahl</div><div class="hint">Linksklick oder Rahmen: auswählen<br>Rechtsklick: bewegen / angreifen<br>A: Angriffsbewegung · S: Stopp<br>Strg+1–9: Gruppe · H: Hauptquartier</div>'
        return
      }
      if (sel.length === 1) {
        const e = sel[0]
        const f = g.players[e.owner].faction
        const icon = e.isB ? this.A.buildings[f][e.key].icon : this.A.units[f][e.key].icon
        const name = e.isB ? e.b!.name : e.u!.name
        const sub = e.isB ? (e.owner === 0 ? 'Gebäude' : 'feindliches Gebäude') : `${ARMOR_NAME[e.u!.armor]}${e.owner !== 0 ? ' · Feind' : ''}`
        el.innerHTML =
          `<div class="stencil sel-title">Auswahl</div>` +
          `<div class="one"><div class="portrait"><img src="${icon.toDataURL()}" alt=""></div><div class="info">` +
          `<div class="nm">${esc(name)}</div><div class="subline">${esc(sub)}</div>` +
          `${e.isB ? '' : this.rankHTML(e)}` +
          `<div class="hp"><div></div></div><div class="hpt"></div><div class="extra"></div></div></div>`
        if (e.owner === 0) {
          const row = document.createElement('div')
          row.className = 'acts'
          const add = (label: string, fn: () => void, cls = '', on = false) => {
            const b = document.createElement('button')
            b.textContent = label
            b.className = cls
            b.classList.toggle('on', on)
            b.onclick = () => {
              fn()
              b.classList.toggle('on')
            }
            row.append(b)
          }
          if (e.isB) {
            if (e.key !== 'hq') add(`Verkaufen (+${Math.round(e.b!.cost * 0.5 * e.hp / e.maxHp)})`, () => { g.sell(e); this.input.setSel([]) })
            add('Reparieren', () => (e.repairing = !e.repairing), 'rep', e.repairing)
            const q = e.b!.produces
            if (q && q !== 'build') add('Hauptgebäude', () => (g.me.primary[q] = e.id), '', g.me.primary[q] === e.id)
          } else if (e.u!.transport) {
            add('Entladen (D)', () => g.commandUnload(e))
          }
          if (row.childElementCount) el.append(row)
        }
      } else {
        const counts = new Map<string, Ent[]>()
        for (const e of sel) {
          const k = (e.isB ? 'b:' : 'u:') + e.key
          if (!counts.has(k)) counts.set(k, [])
          counts.get(k)!.push(e)
        }
        el.innerHTML = `<div class="stencil sel-title">Auswahl · ${sel.length}</div>`
        const wrap = document.createElement('div')
        wrap.className = 'many'
        for (const [k, list] of counts) {
          const b = document.createElement('button')
          b.innerHTML = `<img src="${this.icons.get(k) ?? ''}" alt=""><span>${list.length}</span>`
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
      if (t) t.textContent = `${Math.ceil(e.hp)} / ${e.maxHp}${!e.isB && e.kills ? ` · Abschüsse ${e.kills}` + (e.rank < 3 ? ` (nächster Rang bei ${RANKS[e.rank]})` : '') : ''}`
      const x = el.querySelector('.extra')
      if (x) x.textContent = this.extra(e)
    }
  }

  private extra(e: Ent): string {
    const g = this.g
    const u = e.u
    if (e.isB) {
      if (e.key === 'airfield') return `Stellplätze belegt: ${g.ents.filter((j) => j.jet && !j.dead && j.home === e.id).length} / ${e.b!.slots ?? 3}`
      if (e.repairing) return 'Wird repariert'
      return e.b!.weapon ? `Reichweite ${e.b!.weapon.range}` : ''
    }
    if (!u) return ''
    if (u.harvester) return `Ladung: ${Math.floor(e.cargo)} / ${HARVEST_LOAD}`
    if (u.transport) return `An Bord: ${e.passengers.length} / ${u.transport}`
    if (u.carrier) return `Jets an Bord: ${e.planes} / ${u.carrier}`
    if (u.jet) {
      if (e.js === 'park') return e.ammo >= 1 ? 'Am Boden, einsatzbereit' : `Aufmunitionieren ${Math.floor((e.rearm / 6) * 100)}%`
      return e.js === 'out' ? 'Im Einsatz' : 'Rückflug'
    }
    if (u.stealth) return e.hidden ? 'Getarnt' : 'Sichtbar (stillhalten zum Tarnen)'
    return u.weapon ? `Reichweite ${u.weapon.range} · ${targets(u.weapon)}` : ''
  }

  drawMini() {
    const g = this.g
    const c = this.miniCtx
    const W = this.mini.width, H = this.mini.height
    const T = this.terrain
    c.imageSmoothingEnabled = false
    c.fillStyle = '#0b0d09'
    c.fillRect(0, 0, W, H)
    c.drawImage(T.miniMap(W, H), 0, 0)
    const kx = W / T.cv.width, ky = H / T.cv.height
    const pt = (x: number, y: number) => [((x - y) * (TW / 2) + T.ox) * kx, (x + y) * (TH / 2) * ky]
    for (const e of g.ents) {
      if (e.dead || !this.r.shown(e)) continue
      const [x, y] = pt(e.x, e.y)
      const own = e.owner === 0
      c.fillStyle = own ? (e.selected ? '#ffffff' : '#7dff6a') : '#ff4a3a'
      const s = e.isB ? Math.max(2, e.w * 1.6) : e.naval ? 3 : 2
      c.fillRect(Math.round(x - s / 2), Math.round(y - s / 4), s, Math.max(1, s / 2))
    }
    // fog
    c.save()
    c.imageSmoothingEnabled = true
    c.setTransform((TW / 2) * kx, (TH / 2) * ky, -(TW / 2) * kx, (TH / 2) * ky, T.ox * kx, 0)
    c.drawImage(this.r.fogCv, 0, 0)
    c.restore()
    // a map sheet's grid with letters and numbers
    c.strokeStyle = 'rgba(216,191,92,0.18)'
    c.lineWidth = 1
    c.fillStyle = 'rgba(216,191,92,0.6)'
    c.font = '7px monospace'
    for (let i = 1; i < 8; i++) {
      const x = Math.round((i * W) / 8) + 0.5
      c.beginPath()
      c.moveTo(x, 0)
      c.lineTo(x, H)
      c.stroke()
    }
    for (let j = 1; j < 4; j++) {
      const y = Math.round((j * H) / 4) + 0.5
      c.beginPath()
      c.moveTo(0, y)
      c.lineTo(W, y)
      c.stroke()
    }
    for (let i = 0; i < 8; i++) c.fillText('ABCDEFGH'[i], (i * W) / 8 + 2, 8)
    for (let j = 0; j < 4; j++) c.fillText(String(j + 1), 2, (j * H) / 4 + 17)
    // the view
    const x0 = (this.r.cam.x + T.ox) * kx, y0 = this.r.cam.y * ky
    c.strokeStyle = '#f2e6a8'
    c.strokeRect(Math.round(x0) + 0.5, Math.round(y0) + 0.5, Math.round(this.r.W * kx), Math.round(this.r.H * ky))
  }
}

export { TAB_NAME }
