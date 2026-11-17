// The state of a battle and everything that changes it: units driving and fighting, shells in
// the air, buildings going up, ore being hauled, money and power, and the fog over the map.

import { GameMap, Ter, generateMap, type MapType } from './map'
import { PathFinder } from './path'
import {
  unitDefs, buildingDefs, VS, START_CREDITS, HARVEST_LOAD, BUILD_RADIUS, QUEUES, RANKS, RANK_NAME, reaches,
  type UnitDef, type BuildingDef, type WeaponDef, type Queue, type Proj, type WClass,
} from './defs'
import type { Faction } from './colors'
import { mulberry32 } from '../core/rng'

export type Order = 'idle' | 'move' | 'attack' | 'amove' | 'harvest' | 'board' | 'unload' | 'strike'
/** a jet: parked at home, flying out to a strike, flying back, coming in to land */
export type JState = 'park' | 'out' | 'back' | 'land'
export type HState = 'idle' | 'toOre' | 'mining' | 'toRef' | 'unload'

export interface QItem {
  key: string
  paid: number
  progress: number
  ready: boolean
}

export interface Player {
  id: number
  faction: Faction
  ai: boolean
  credits: number
  powerProd: number
  powerUse: number
  units: Record<string, UnitDef>
  queues: Record<Queue, QItem[]>
  alive: boolean
  stats: { built: number; lost: number; killed: number; harvested: number }
  /** the producer new units of a queue leave from */
  primary: Partial<Record<Queue, number>>
  income: number
}

let nextId = 1

export class Ent {
  id = nextId++
  isB: boolean
  u?: UnitDef
  b?: BuildingDef
  hp: number
  maxHp: number
  x: number
  y: number
  z = 0
  dir = Math.PI * 0.75
  tdir = Math.PI * 0.75
  dead = false
  // moving
  path: number[] = []
  pi = 0
  dest: { x: number; y: number } | null = null
  order: Order = 'idle'
  target: Ent | null = null
  amove: { x: number; y: number } | null = null
  guard: { x: number; y: number } | null = null
  moving = false
  speedNow = 0
  stuckT = 0
  stuckX = 0
  stuckY = 0
  repaths = 0
  repathT = 0
  scanT = Math.random() * 0.3
  anim = Math.random() * 10
  // weapons
  cd = Math.random() * 0.5
  burst = 0
  burstT = 0
  // harvester
  cargo = 0
  hs: HState = 'idle'
  oreTile = -1
  mineT = 0
  // building
  tx = 0
  ty = 0
  w = 1
  h = 1
  built = 1
  rally: { x: number; y: number } | null = null
  repairing = false
  // bookkeeping
  lastHit = -99
  lastAttacker: Ent | null = null
  selected = false
  smokeT = 0
  // carrying and being carried
  passengers: Ent[] = []
  carriedBy: Ent | null = null
  boardOn: Ent | null = null
  unloadAt: { x: number; y: number } | null = null
  // jets
  home = 0
  slot = -1
  js: JState = 'park'
  ammo = 1
  rearm = 0
  strike: { e: Ent | null; x: number; y: number } | null = null
  jspeed = 0
  // a carrier's own jets
  planes = 0
  planeT = 0
  launchT = 0
  // experience, stealth and looks
  kills = 0
  rank = 0
  stillT = 0
  firedT = -99
  flashT = -99
  wakeT = 0
  constructor(public owner: number, public key: string, def: UnitDef | BuildingDef, isB: boolean) {
    this.isB = isB
    if (isB) this.b = def as BuildingDef
    else this.u = def as UnitDef
    this.hp = this.maxHp = def.hp
    this.x = 0
    this.y = 0
  }
  get weapon(): WeaponDef | undefined {
    return this.isB ? this.b!.weapon : this.u!.weapon
  }
  get radius(): number {
    return this.isB ? Math.max(this.w, this.h) / 2 : this.u!.radius
  }
  get air(): boolean {
    return !!this.u?.air
  }
  get naval(): boolean {
    return !!this.u?.naval
  }
  get jet(): boolean {
    return !!this.u?.jet
  }
  /** a sniper keeping still */
  get hidden(): boolean {
    return !!this.u?.stealth && this.stillT > 2.5
  }
  get sight(): number {
    return (this.isB ? this.b!.sight : this.u!.sight)
  }
}

export interface Shot {
  kind: Proj
  owner: number
  x0: number
  y0: number
  z0: number
  x1: number
  y1: number
  z1: number
  target: Ent | null
  t: number
  T: number
  arc: number
  dmg: number
  cls: WClass
  splash: number
  trailT: number
  /** the shooter, for its record */
  src: number
}

export type FxKind = 'exp' | 'smoke' | 'fire' | 'flash' | 'spark' | 'dust' | 'debris' | 'wake' | 'splash'
export interface Fx {
  kind: FxKind
  x: number
  y: number
  z: number
  vx: number
  vy: number
  vz: number
  t: number
  life: number
  size: number
}

export interface Wreck {
  key: string
  owner: number
  x: number
  y: number
  dir: number
  tdir: number
  t: number
  air: boolean
  naval: boolean
}

export interface Msg {
  text: string
  t: number
  kind: 'info' | 'warn' | 'good'
}

export type TimeOfDay = 'day' | 'dusk' | 'night'
export type Weather = 'clear' | 'clouds' | 'rain'

export interface GameOpts {
  seed: number
  faction: Faction
  difficulty: 0 | 1 | 2
  mapType: MapType
  tod: TimeOfDay
  weather: Weather
}

export class Game {
  map: GameMap
  pf: PathFinder
  /** path finding on the water */
  npf: PathFinder
  ents: Ent[] = []
  byId = new Map<number, Ent>()
  players: Player[] = []
  bdefs = buildingDefs()
  shots: Shot[] = []
  fx: Fx[] = []
  wrecks: Wreck[] = []
  msgs: Msg[] = []
  time = 0
  rand = mulberry32(12345)
  /** fog for the human player: 0 never seen, 1 seen before, 2 in sight now */
  fog: Uint8Array
  fogDirty = true
  private fogT = 0
  private checkT = 0
  over: 0 | 1 | -1 = 0
  /** ground marks waiting to be painted onto the terrain */
  stamps: { kind: 'scorch' | 'rubble'; size: number; x: number; y: number }[] = []
  oreChanged: number[] = []
  // spatial hash of ground units by tile
  private head: Int32Array
  private next: Int32Array = new Int32Array(0)
  private list: Ent[] = []
  alertT = -99
  onSound: (name: string, x: number, y: number) => void = () => {}

  constructor(public opts: GameOpts) {
    this.map = generateMap(opts.seed, opts.mapType)
    this.pf = new PathFinder(this.map)
    this.npf = new PathFinder(this.map, (i) => this.map.navI(i))
    this.fog = new Uint8Array(this.map.N * this.map.N)
    this.head = new Int32Array(this.map.N * this.map.N)
    const enemy: Faction = opts.faction === 'nato' ? 'ru' : 'nato'
    // the NATO side always starts in the west
    const factions: Faction[] = [opts.faction, enemy]
    for (let i = 0; i < 2; i++) {
      const f = factions[i]
      this.players.push({
        id: i, faction: f, ai: i === 1, credits: START_CREDITS, powerProd: 0, powerUse: 0,
        units: unitDefs(f), queues: { build: [], inf: [], veh: [], air: [], sea: [] }, alive: true,
        stats: { built: 0, lost: 0, killed: 0, harvested: 0 }, primary: {}, income: 0,
      })
    }
    for (let i = 0; i < 2; i++) {
      const p = this.players[i]
      const start = this.map.starts[p.faction === 'nato' ? 0 : 1]
      const hq = this.addBuilding(i, 'hq', start.x - 1, start.y - 1)
      hq.built = 1
      const sx = start.x + 0.5, sy = start.y + 0.5
      const toward = p.faction === 'nato' ? 1 : -1
      this.addUnit(i, 'ifv', sx + toward * 3, sy - toward * 3)
      this.addUnit(i, 'rifle', sx + toward * 2.4, sy + toward * 2.2)
      this.addUnit(i, 'rifle', sx + toward * 2.9, sy + toward * 2.0)
      this.addUnit(i, 'rifle', sx + toward * 2.6, sy + toward * 2.7)
    }
    this.updatePower()
    this.updateFog()
  }

  get me(): Player {
    return this.players[0]
  }
  enemyOf(p: number) {
    return p === 0 ? 1 : 0
  }

  msg(text: string, kind: Msg['kind'] = 'info', player = 0) {
    if (player !== 0) return
    if (this.msgs.length && this.msgs[this.msgs.length - 1].text === text && this.time - this.msgs[this.msgs.length - 1].t < 3) return
    this.msgs.push({ text, t: this.time, kind })
    if (this.msgs.length > 6) this.msgs.shift()
  }

  // ─────────────────────────────────────────────────────── creating things

  addUnit(owner: number, key: string, x: number, y: number): Ent {
    const def = this.players[owner].units[key]
    const e = new Ent(owner, key, def, false)
    e.x = x
    e.y = y
    e.dir = this.players[owner].faction === 'nato' ? -Math.PI / 4 : Math.PI * 0.75
    e.tdir = e.dir
    if (def.air) e.z = 0
    this.ents.push(e)
    this.byId.set(e.id, e)
    if (def.harvester) e.hs = 'toOre'
    if (def.air && !def.jet) e.order = 'move'
    if (def.carrier) e.planes = def.carrier
    return e
  }

  addBuilding(owner: number, key: string, tx: number, ty: number): Ent {
    const def = this.bdefs[key]
    const e = new Ent(owner, key, def, true)
    e.tx = tx
    e.ty = ty
    e.w = def.w
    e.h = def.h
    e.x = tx + def.w / 2
    e.y = ty + def.h / 2
    e.built = 0
    e.tdir = this.players[owner].faction === 'nato' ? -Math.PI / 4 : Math.PI * 0.75
    for (let y = ty; y < ty + def.h; y++) for (let x = tx; x < tx + def.w; x++) this.map.bld[this.map.idx(x, y)] = e.id
    this.ents.push(e)
    this.byId.set(e.id, e)
    // anyone standing there steps aside
    for (const u of this.ents) {
      if (u.isB || u.air || u.dead) continue
      if (u.x >= tx - 0.3 && u.x < tx + def.w + 0.3 && u.y >= ty - 0.3 && u.y < ty + def.h + 0.3) {
        const w = this.pf.nearestWalkable(u.x, u.y)
        if (w) {
          u.x = w.x + 0.5
          u.y = w.y + 0.5
          u.path = []
        }
      }
    }
    this.updatePower()
    return e
  }

  hasBuilding(p: number, key: string): boolean {
    return this.ents.some((e) => e.isB && !e.dead && e.owner === p && e.key === key && e.built >= 1)
  }

  /** what is missing before something can be built */
  missing(p: number, req: string[]): string[] {
    return req.filter((k) => !this.hasBuilding(p, k))
  }

  canPlace(p: number, key: string, tx: number, ty: number): boolean {
    const def = this.bdefs[key]
    const m = this.map
    for (let y = ty; y < ty + def.h; y++)
      for (let x = tx; x < tx + def.w; x++) {
        if (!m.buildable(x, y)) return false
        for (const u of this.ents) if (!u.isB && !u.dead && !u.air && u.owner !== p && Math.floor(u.x) === x && Math.floor(u.y) === y) return false
      }
    // a shipyard needs open water along its side
    if (def.shore && this.shoreTiles(tx, ty, def.w, def.h) < 3) return false
    // close enough to a building of our own
    const reach = def.reach ?? BUILD_RADIUS
    for (const e of this.ents) {
      if (!e.isB || e.dead || e.owner !== p) continue
      const dx = Math.max(e.tx - (tx + def.w), tx - (e.tx + e.w), 0)
      const dy = Math.max(e.ty - (ty + def.h), ty - (e.ty + e.h), 0)
      if (Math.max(dx, dy) <= reach) return true
    }
    return false
  }

  /** how many water tiles touch the edge of a footprint */
  shoreTiles(tx: number, ty: number, w: number, h: number): number {
    let n = 0
    for (let y = ty - 1; y <= ty + h; y++)
      for (let x = tx - 1; x <= tx + w; x++) {
        if (x >= tx && x < tx + w && y >= ty && y < ty + h) continue
        if (this.map.nav(x, y)) n++
      }
    return n
  }

  // ─────────────────────────────────────────────────────── production

  queueItem(p: number, q: Queue, key: string): boolean {
    const pl = this.players[p]
    const list = pl.queues[q]
    if (list.length >= (q === 'build' ? 1 : 9)) return false
    const def = q === 'build' ? this.bdefs[key] : pl.units[key]
    if (!def || this.missing(p, def.req).length) return false
    list.push({ key, paid: 0, progress: 0, ready: false })
    return true
  }

  cancelItem(p: number, q: Queue, key: string) {
    const list = this.players[p].queues[q]
    for (let i = list.length - 1; i >= 0; i--) {
      if (list[i].key === key) {
        this.players[p].credits += list[i].paid
        list.splice(i, 1)
        return
      }
    }
  }

  placeReady(p: number, tx: number, ty: number): boolean {
    const list = this.players[p].queues.build
    const it = list[0]
    if (!it || !it.ready) return false
    if (!this.canPlace(p, it.key, tx, ty)) return false
    list.shift()
    this.addBuilding(p, it.key, tx, ty)
    this.players[p].stats.built++
    this.onSound('place', tx, ty)
    return true
  }

  private produce(dt: number) {
    for (const pl of this.players) {
      if (!pl.alive) continue
      const low = pl.powerUse > pl.powerProd
      for (const q of QUEUES) {
        const it = pl.queues[q][0]
        if (!it || it.ready) continue
        const prod = q === 'build' ? 'hq' : pl.units[it.key].producer
        const n = this.ents.filter((e) => e.isB && !e.dead && e.owner === pl.id && e.key === prod && e.built >= 1).length
        if (!n) continue
        const def = q === 'build' ? this.bdefs[it.key] : pl.units[it.key]
        let speed = (1 + 0.5 * (n - 1)) * (low ? 0.45 : 1)
        if (pl.ai) speed *= [0.8, 1, 1.25][this.opts.difficulty]
        const dp = Math.min(1 - it.progress, (dt * speed) / def.time)
        const cost = dp * def.cost
        if (pl.credits < cost) {
          if (pl.id === 0 && Math.floor(this.time) % 10 === 0) this.msg('Nicht genug Rohstoffe', 'warn')
          continue
        }
        pl.credits -= cost
        it.paid += cost
        it.progress += dp
        if (it.progress >= 0.9999) {
          if (q === 'build') {
            it.ready = true
            this.msg(`${def.name} bereit zum Platzieren`, 'good', pl.id)
            this.onSound('ready', 0, 0)
          } else if (this.spawnFrom(pl, q, it.key)) {
            pl.queues[q].shift()
          }
        }
      }
    }
  }

  /** where a unit leaves a building */
  exitOf(b: Ent): { x: number; y: number } {
    const w = this.pf.nearestWalkable(b.tx + b.w / 2, b.ty + b.h + 0.6, 6)
    return w ? { x: w.x + 0.5, y: w.y + 0.5 } : { x: b.x, y: b.y + b.h }
  }

  /** where a parked jet stands on an airfield */
  slotPos(b: Ent, s: number): { x: number; y: number } {
    return { x: b.tx + 0.6 + s * 1.125, y: b.ty + 2.25 }
  }

  /** a free parking spot on one of a player's airfields, the nearest first */
  freeSlot(owner: number, near?: { x: number; y: number }): { b: Ent; s: number } | null {
    let best: { b: Ent; s: number } | null = null
    let bd = 1e9
    for (const b of this.ents) {
      if (!b.isB || b.dead || b.owner !== owner || b.key !== 'airfield' || b.built < 1) continue
      const used = new Set(this.ents.filter((j) => j.jet && !j.dead && j.home === b.id).map((j) => j.slot))
      for (let s = 0; s < (b.b!.slots ?? 3); s++) {
        if (used.has(s)) continue
        const d = near ? Math.hypot(b.x - near.x, b.y - near.y) : 0
        if (d < bd) {
          bd = d
          best = { b, s }
        }
        break
      }
    }
    return best
  }

  private spawnFrom(pl: Player, q: Queue, key: string): boolean {
    const def = pl.units[key]
    const prod = def.producer
    const cands = this.ents.filter((e) => e.isB && !e.dead && e.owner === pl.id && e.key === prod && e.built >= 1)
    if (!cands.length) return false
    const b = cands.find((e) => e.id === pl.primary[q]) ?? cands[cands.length - 1]
    let u: Ent
    if (def.jet) {
      const spot = this.freeSlot(pl.id, b)
      if (!spot) {
        if (Math.floor(this.time) % 15 === 0) this.msg('Alle Stellplätze auf dem Flugfeld belegt', 'warn', pl.id)
        return false
      }
      const p = this.slotPos(spot.b, spot.s)
      u = this.addUnit(pl.id, key, p.x, p.y)
      u.home = spot.b.id
      u.slot = spot.s
      u.dir = u.tdir = Math.PI / 2
      u.js = 'park'
      u.ammo = 1
      this.msg(`${def.name} bereit`, 'good', pl.id)
      return true
    }
    if (def.naval) {
      const w = this.npf.nearestWalkable(b.x, b.y, 8)
      if (!w) return false
      u = this.addUnit(pl.id, key, w.x + 0.5, w.y + 0.5)
      const out = this.npf.nearestWalkable(w.x + (w.x - b.x) * 0.6, w.y + (w.y - b.y) * 0.6, 6) ?? w
      u.dir = u.tdir = Math.atan2(out.y - w.y, out.x - w.x)
      if (b.rally) this.commandMove([u], b.rally.x, b.rally.y, false)
      else this.commandMove([u], out.x + 0.5, out.y + 0.5, false)
      this.msg(`${def.name} bereit`, 'good', pl.id)
      if (pl.id === 0) this.onSound('unit', u.x, u.y)
      return true
    }
    if (def.air) {
      u = this.addUnit(pl.id, key, b.x, b.y)
    } else {
      const ex = this.exitOf(b)
      u = this.addUnit(pl.id, key, ex.x, ex.y)
      u.dir = u.tdir = Math.PI / 2 + 0.3
    }
    if (b.rally) this.commandMove([u], b.rally.x, b.rally.y, false)
    else if (def.air) this.commandMove([u], b.x + 1.5, b.y + 1.5, false)
    else if (!def.harvester) this.commandMove([u], u.x + 0.8, u.y + 1.6, false)
    if (def.harvester) {
      u.hs = 'toOre'
      u.order = 'harvest'
    }
    this.msg(`${def.name} bereit`, 'good', pl.id)
    if (pl.id === 0) this.onSound('unit', u.x, u.y)
    return true
  }

  updatePower() {
    for (const pl of this.players) {
      pl.powerProd = 0
      pl.powerUse = 0
    }
    for (const e of this.ents) {
      if (!e.isB || e.dead || e.built < 1) continue
      const pw = e.b!.power
      const pl = this.players[e.owner]
      if (pw > 0) pl.powerProd += Math.round(pw * (0.5 + 0.5 * e.hp / e.maxHp))
      else pl.powerUse -= pw
    }
  }

  sell(e: Ent) {
    if (!e.isB || e.dead || e.key === 'hq') return
    const pl = this.players[e.owner]
    pl.credits += Math.round(e.b!.cost * 0.5 * (e.hp / e.maxHp))
    this.removeBuilding(e, false)
    this.onSound('sell', e.x, e.y)
  }

  // ─────────────────────────────────────────────────────── orders

  /** send units to a place, spread out so they do not all fight for one tile */
  commandMove(units: Ent[], x: number, y: number, attackMove: boolean) {
    const live = units.filter((u) => !u.isB && !u.dead && !u.carriedBy)
    const ground = live.filter((u) => !u.air && !u.naval)
    const ships = live.filter((u) => u.naval)
    const air = live.filter((u) => u.air && !u.jet)
    const jets = live.filter((u) => u.jet)
    if (jets.length) this.commandStrike(jets, null, x, y)
    // a loaded landing ship sent onto land puts its troops ashore there
    const tx = Math.floor(x), ty = Math.floor(y)
    const onLand = this.map.walk(tx, ty) || (this.map.inMap(tx, ty) && this.map.bld[this.map.idx(tx, ty)] > 0)
    for (const sh of ships.filter((u) => u.passengers.length && onLand)) this.commandUnload(sh, x, y)
    const sailing = ships.filter((u) => !(u.passengers.length && onLand))
    const go = (list: Ent[], slots: { x: number; y: number }[]) =>
      list.forEach((u, i) => {
        const s = slots[i] ?? { x, y }
        this.setDest(u, s.x, s.y)
        u.order = attackMove ? 'amove' : 'move'
        u.amove = attackMove ? { x: s.x, y: s.y } : null
        u.target = null
        u.guard = null
        u.boardOn = null
        if (u.u!.harvester) u.hs = 'idle'
      })
    go(ground, this.formation(x, y, ground, false))
    go(sailing, this.formation(x, y, sailing, true))
    air.forEach((u, i) => {
      const a = (i / Math.max(1, air.length)) * Math.PI * 2
      const r = air.length > 1 ? 0.8 : 0
      u.dest = { x: x + Math.cos(a) * r, y: y + Math.sin(a) * r }
      u.path = []
      u.order = attackMove ? 'amove' : 'move'
      u.amove = attackMove ? { ...u.dest } : null
      u.target = null
      u.guard = null
    })
  }

  formation(x: number, y: number, units: Ent[], naval: boolean): { x: number; y: number }[] {
    if (!units.length) return []
    const m = this.map
    const pf = naval ? this.npf : this.pf
    // boats sent onto land go to the nearest water
    if (naval && !m.nav(Math.floor(x), Math.floor(y))) {
      const w = this.npf.nearestWalkable(x, y, 30)
      if (w) {
        x = w.x + 0.5
        y = w.y + 0.5
      }
    }
    const cx = Math.floor(x), cy = Math.floor(y)
    const tiles: { x: number; y: number; d: number }[] = []
    const need = units.reduce((n, u) => n + (u.u!.infantry ? 0.34 : u.radius > 0.7 ? 3 : 1), 0)
    for (let r = 0; r < 16 && tiles.length < need * 1.2 + 1; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          if (!pf.ok(cx + dx, cy + dy)) continue
          tiles.push({ x: cx + dx, y: cy + dy, d: Math.hypot(dx, dy) })
        }
    tiles.sort((a, b) => a.d - b.d)
    // vehicles take whole tiles; soldiers share them three to a tile; big ships keep a tile clear round them
    const out: { x: number; y: number }[] = new Array(units.length)
    const order = units.map((u, i) => i).sort((a, b) => Math.hypot(units[a].x - x, units[a].y - y) - Math.hypot(units[b].x - x, units[b].y - y))
    const OFF = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.7], [0.3, 0.75]]
    const fill = new Map<number, number>()
    for (const i of order) {
      const inf = units[i].u!.infantry
      const big = units[i].radius > 0.7
      for (const t of tiles) {
        const k = m.idx(t.x, t.y)
        const used = fill.get(k) ?? 0
        if (inf ? used < 3 && used !== -1 : used === 0) {
          const o = inf ? OFF[used + 1] : OFF[0]
          out[i] = { x: t.x + o[0], y: t.y + o[1] }
          fill.set(k, inf ? used + 1 : -1)
          if (big)
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (m.inMap(t.x + dx, t.y + dy)) fill.set(m.idx(t.x + dx, t.y + dy), -1)
          break
        }
      }
      if (!out[i]) out[i] = { x, y }
    }
    return out
  }

  pfOf(u: Ent): PathFinder {
    return u.naval ? this.npf : this.pf
  }

  setDest(u: Ent, x: number, y: number) {
    const pf = this.pfOf(u)
    u.dest = { x, y }
    u.path = pf.find(Math.floor(u.x), Math.floor(u.y), Math.floor(x), Math.floor(y))
    u.pi = 0
    u.repaths = 0
    u.stuckT = 0
    // the last step goes to the exact place, not the tile's middle
    if (u.path.length && u.path[u.path.length - 1] === this.map.idx(Math.floor(x), Math.floor(y))) u.dest = { x, y }
    else if (u.path.length) {
      const last = u.path[u.path.length - 1]
      u.dest = { x: (last % this.map.N) + 0.5, y: Math.floor(last / this.map.N) + 0.5 }
    } else u.dest = null
  }

  commandAttack(units: Ent[], t: Ent) {
    const jets = units.filter((u) => u.jet)
    if (jets.length) this.commandStrike(jets, t, t.x, t.y)
    for (const u of units) {
      if (u.isB || u.dead || !u.weapon || u.jet || u.carriedBy) continue
      if (!this.canHit(u, t)) continue
      u.order = 'attack'
      u.target = t
      u.amove = null
      u.guard = null
      u.path = []
      u.dest = null
      u.repathT = 0
    }
  }

  /** jets fly a strike at a target or a point, if they have weapons on board */
  commandStrike(jets: Ent[], t: Ent | null, x: number, y: number) {
    let rearming = false
    for (const j of jets) {
      if (!j.jet || j.dead) continue
      if (j.ammo < 1) {
        rearming = true
        continue
      }
      j.strike = { e: t, x, y }
      j.order = 'strike'
      if (j.js === 'park' || j.js === 'land') j.js = 'out'
      else j.js = 'out'
    }
    if (rearming && jets[0]?.owner === 0) this.msg('Jets werden noch aufmunitioniert', 'warn')
  }

  commandStop(units: Ent[]) {
    for (const u of units) {
      if (u.isB || u.jet) continue
      u.order = 'idle'
      u.target = null
      u.path = []
      u.dest = null
      u.amove = null
      u.boardOn = null
      u.guard = { x: u.x, y: u.y }
      if (u.u!.harvester) u.hs = 'idle'
    }
  }

  commandHarvest(units: Ent[], tile: number) {
    for (const u of units) {
      if (!u.u?.harvester) continue
      u.order = 'harvest'
      u.oreTile = tile
      u.hs = 'toOre'
      u.path = []
      u.dest = null
      const tx = tile % this.map.N, ty = Math.floor(tile / this.map.N)
      this.setDest(u, tx + 0.5, ty + 0.5)
    }
  }

  commandReturn(units: Ent[]) {
    for (const u of units) {
      if (!u.u?.harvester) continue
      u.order = 'harvest'
      u.hs = 'toRef'
      u.path = []
      u.dest = null
    }
  }

  /** ground units walk to a landing ship and go aboard; the ship comes to the nearest shore to meet them */
  commandBoard(units: Ent[], tr: Ent) {
    const troops = units.filter((u) => !u.isB && !u.dead && !u.air && !u.naval && !u.carriedBy)
    if (!troops.length) return
    const cx = troops.reduce((a, u) => a + u.x, 0) / troops.length
    const cy = troops.reduce((a, u) => a + u.y, 0) / troops.length
    // meet halfway between the troops and the ship, at the water's edge
    const sp = this.shorePoint(cx + (tr.x - cx) * 0.25, cy + (tr.y - cy) * 0.25)
    if (sp) {
      this.setDest(tr, sp.water.x, sp.water.y)
      tr.order = 'move'
    }
    for (const u of troops) {
      u.order = 'board'
      u.boardOn = tr
      u.target = null
      u.path = []
      u.dest = null
      u.repathT = 0
      if (sp) this.setDest(u, sp.land.x, sp.land.y)
      u.repathT = 2
      if (u.u!.harvester) u.hs = 'idle'
    }
  }

  /** a water tile at the shore nearest a point, and the land tile beside it */
  shorePoint(x: number, y: number, maxR = 24): { water: { x: number; y: number }; land: { x: number; y: number } } | null {
    const m = this.map
    const cx = Math.floor(x), cy = Math.floor(y)
    for (let r = 0; r <= maxR; r++) {
      let best: { water: { x: number; y: number }; land: { x: number; y: number } } | null = null
      let bd = 1e9
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const wx = cx + dx, wy = cy + dy
          if (!m.nav(wx, wy) || m.ter[m.idx(wx, wy)] === Ter.Bridge) continue
          for (const [nx, ny] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const lx = wx + nx, ly = wy + ny
            if (!m.walk(lx, ly) || m.ter[m.idx(lx, ly)] === Ter.Bridge) continue
            const d = Math.hypot(dx, dy)
            if (d < bd) {
              bd = d
              best = { water: { x: wx + 0.5, y: wy + 0.5 }, land: { x: lx + 0.5, y: ly + 0.5 } }
            }
          }
        }
      if (best) return best
    }
    return null
  }

  /** a landing ship takes its troops to the shore nearest a point (or puts them ashore right here) */
  commandUnload(tr: Ent, x?: number, y?: number) {
    if (!tr.passengers.length) return
    if (x === undefined || y === undefined) {
      if (!this.unloadHere(tr, null)) this.msg('Zu weit vom Ufer zum Entladen', 'warn', tr.owner)
      return
    }
    const sp = this.shorePoint(x, y, 14)
    if (!sp) {
      this.msg('Dort ist kein Ufer zum Anlanden', 'warn', tr.owner)
      return
    }
    const best = sp.water
    this.setDest(tr, best.x, best.y)
    tr.order = 'unload'
    tr.unloadAt = { x, y }
  }

  private board(u: Ent, tr: Ent) {
    const cap = tr.u?.transport ?? 0
    u.order = 'idle'
    u.boardOn = null
    if (tr.passengers.length >= cap) {
      this.msg('Das Landungsschiff ist voll', 'warn', u.owner)
      return
    }
    tr.passengers.push(u)
    u.carriedBy = tr
    u.selected = false
    u.path = []
    u.dest = null
    u.target = null
    this.onSound('board', u.x, u.y)
  }

  /** everyone off onto the nearest land; returns false if there is none in reach */
  private unloadHere(tr: Ent, goal: { x: number; y: number } | null): boolean {
    const m = this.map
    const spots: { x: number; y: number; d: number }[] = []
    const cx = Math.floor(tr.x), cy = Math.floor(tr.y)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const x = cx + dx, y = cy + dy
        if (!m.walk(x, y) || m.ter[m.idx(x, y)] === Ter.Bridge) continue
        const d = Math.hypot(x + 0.5 - tr.x, y + 0.5 - tr.y)
        if (d < 3.2) spots.push({ x, y, d })
      }
    if (!spots.length) return false
    spots.sort((a, b) => a.d - b.d)
    const out = tr.passengers.splice(0)
    out.forEach((u, i) => {
      const s = spots[Math.min(spots.length - 1, Math.floor(i / (u.u!.infantry ? 3 : 1)))]
      u.carriedBy = null
      u.x = s.x + 0.3 + this.rand() * 0.4
      u.y = s.y + 0.3 + this.rand() * 0.4
      u.order = 'idle'
      u.guard = { x: u.x, y: u.y }
    })
    if (goal) this.commandMove(out, goal.x, goal.y, false)
    this.onSound('unload', tr.x, tr.y)
    return true
  }

  canHit(u: Ent, t: Ent): boolean {
    const w = u.weapon
    if (!w || t.dead || t.carriedBy) return false
    return reaches(w, t)
  }

  // ─────────────────────────────────────────────────────── the tick

  update(dt: number) {
    if (this.over) return
    this.time += dt
    this.produce(dt)
    this.buildSpatial()
    for (let i = 0; i < this.ents.length; i++) {
      const e = this.ents[i]
      if (e.dead) continue
      if (e.isB) this.updateBuilding(e, dt)
      else this.updateUnit(e, dt)
    }
    this.separate(dt)
    this.updateShots(dt)
    this.updateFx(dt)
    // forget the dead
    if (this.ents.some((e) => e.dead)) {
      this.ents = this.ents.filter((e) => !e.dead)
    }
    for (let i = this.wrecks.length - 1; i >= 0; i--) {
      const w = this.wrecks[i]
      w.t += dt
      if (w.t < 14 && this.rand() < dt * 2.2) this.addFx('smoke', w.x, w.y, 6, 0, 0, 10 + this.rand() * 6, 2.5, 3)
      if (w.t < 6 && this.rand() < dt * 5) this.addFx('fire', w.x + (this.rand() - 0.5) * 0.3, w.y + (this.rand() - 0.5) * 0.3, 4, 0, 0, 0, 0.6, 1)
      if (w.naval && this.rand() < dt * 6) this.addFx('wake', w.x + (this.rand() - 0.5), w.y + (this.rand() - 0.5), 0, 0, 0, 0, 1.2, 2)
      if (w.t > (w.naval ? 9 : 40)) this.wrecks.splice(i, 1)
    }
    this.fogT -= dt
    if (this.fogT <= 0) {
      this.fogT = 0.2
      this.updateFog()
    }
    this.checkT -= dt
    if (this.checkT <= 0) {
      this.checkT = 1
      for (const pl of this.players) {
        const alive = this.ents.some((e) => e.owner === pl.id && e.isB && !e.dead)
        pl.alive = alive
      }
      if (!this.players[0].alive) this.over = -1
      else if (!this.players[1].alive) this.over = 1
      // a slow trickle so a broke player is never stuck for good
      for (const pl of this.players) if (pl.alive && pl.credits < 1000 && !this.ents.some((e) => e.owner === pl.id && e.u?.harvester)) pl.credits += 8
    }
  }

  private updateBuilding(b: Ent, dt: number) {
    if (b.built < 1) {
      b.built = Math.min(1, b.built + dt / 1.6)
      if (b.built >= 1) {
        this.updatePower()
        if (b.key === 'ref') {
          const ex = { x: b.tx + b.w + 0.5, y: b.ty + b.h - 0.5 }
          const w = this.pf.nearestWalkable(ex.x, ex.y)
          const u = this.addUnit(b.owner, 'harv', w ? w.x + 0.5 : ex.x, w ? w.y + 0.5 : ex.y)
          u.order = 'harvest'
          u.hs = 'toOre'
        }
        this.msg(`${b.b!.name} fertig`, 'good', b.owner)
      }
      return
    }
    // repairs cost a little money
    if (b.repairing) {
      const pl = this.players[b.owner]
      const rate = b.maxHp / 25
      const heal = Math.min(rate * dt, b.maxHp - b.hp)
      const cost = (heal / b.maxHp) * b.b!.cost * 0.3
      if (heal <= 0) b.repairing = false
      else if (pl.credits >= cost) {
        pl.credits -= cost
        b.hp += heal
        if (this.rand() < dt * 3) this.addFx('spark', b.x + (this.rand() - 0.5) * b.w, b.y + (this.rand() - 0.5) * b.h, 10 + this.rand() * 10, 0, 0, 8, 0.4, 1)
      }
    }
    // damaged buildings smoke and burn
    const k = b.hp / b.maxHp
    if (k < 0.5) {
      b.smokeT -= dt
      if (b.smokeT <= 0) {
        b.smokeT = k < 0.25 ? 0.25 : 0.6
        const ox = (this.rand() - 0.5) * b.w * 0.8, oy = (this.rand() - 0.5) * b.h * 0.8
        this.addFx('smoke', b.x + ox, b.y + oy, 12, 0, 0, 12, 3, 3 + this.rand() * 2)
        if (k < 0.25) this.addFx('fire', b.x + ox, b.y + oy, 8, 0, 0, 0, 0.7, 1)
      }
    }
    if (b.weapon) {
      const low = this.players[b.owner].powerUse > this.players[b.owner].powerProd
      if (b.target && (b.target.dead || this.dist(b, b.target) > b.weapon.range + 0.5 || !this.visibleTo(b.owner, b.target))) b.target = null
      b.scanT -= dt
      if (!b.target && b.scanT <= 0) {
        b.scanT = 0.4
        b.target = this.findTarget(b, b.weapon.range)
      }
      this.aimAndFire(b, dt * (low ? 0.5 : 1))
    }
  }

  private updateUnit(u: Ent, dt: number) {
    const def = u.u!
    // aboard a ship: just ride along
    if (u.carriedBy) {
      u.x = u.carriedBy.x
      u.y = u.carriedBy.y
      return
    }
    if (def.jet) {
      this.updateJet(u, dt)
      return
    }
    u.anim += dt
    const w = def.weapon
    // experience: the best heal themselves
    if (u.rank >= 3 && u.hp < u.maxHp) u.hp = Math.min(u.maxHp, u.hp + u.maxHp * 0.01 * dt)
    // keeping still (for snipers)
    if (u.moving || this.time - u.firedT < 0.5) u.stillT = 0
    else u.stillT += dt
    if (def.carrier) this.carrierDeck(u, dt)
    if (u.order === 'board') {
      const tr = u.boardOn
      if (!tr || tr.dead) {
        u.order = 'idle'
        u.boardOn = null
      } else if (Math.hypot(tr.x - u.x, tr.y - u.y) < tr.radius + 1.7) {
        this.board(u, tr)
        return
      } else {
        u.repathT -= dt
        if (u.repathT <= 0 || (!u.path.length && !u.dest && u.repathT < 1)) {
          u.repathT = 2
          const sp = this.shorePoint(tr.x, tr.y, 6)
          if (sp) this.setDest(u, sp.land.x, sp.land.y)
        }
      }
      this.move(u, dt)
      return
    }
    // targets
    if (u.target && (u.target.dead || (u.target.owner !== u.owner && !this.visibleTo(u.owner, u.target) && u.order !== 'attack'))) {
      u.target = null
      if (u.order === 'attack') {
        u.order = u.amove ? 'amove' : 'idle'
        if (u.amove) this.setDest(u, u.amove.x, u.amove.y)
        else u.guard = { x: u.x, y: u.y }
      }
    }
    if (w) {
      u.scanT -= dt
      if (u.scanT <= 0) {
        u.scanT = 0.35 + this.rand() * 0.15
        if (u.order === 'idle' || u.order === 'amove') {
          if (!u.target) {
            const t = this.findTarget(u, u.order === 'idle' ? Math.max(w.range, u.sight - 1) : u.sight)
            if (t) u.target = t
          }
          // the guard post: an idle unit does not chase too far
          if (u.order === 'idle' && u.target) {
            if (!u.guard) u.guard = { x: u.x, y: u.y }
            if (Math.hypot(u.target.x - u.guard.x, u.target.y - u.guard.y) > w.range + 5) {
              u.target = null
              if (Math.hypot(u.x - u.guard.x, u.y - u.guard.y) > 1) this.setDest(u, u.guard.x, u.guard.y)
            }
          }
        } else if (u.order === 'move' && (u.u!.weapon && (!!this.mountsTurret(u) || u.air))) {
          // shoot while driving at whatever comes in range
          u.target = this.findTarget(u, w.range)
        } else if (u.order === 'harvest') u.target = null
      }
    }
    // chase or stop to shoot
    if (u.target && w && u.order !== 'move') {
      const d = this.dist(u, u.target)
      if (d > w.range) {
        u.repathT -= dt
        if (u.repathT <= 0 || (!u.path.length && !u.air)) {
          u.repathT = 1.2
          if (u.air) u.dest = { x: u.target.x, y: u.target.y }
          else this.setDest(u, u.target.x, u.target.y)
        }
      } else if (w.minRange && d < w.minRange && !u.air) {
        // too close for artillery: back off
        u.repathT -= dt
        if (u.repathT <= 0) {
          u.repathT = 1.5
          const a = Math.atan2(u.y - u.target.y, u.x - u.target.x)
          this.setDest(u, u.x + Math.cos(a) * 3, u.y + Math.sin(a) * 3)
        }
      } else {
        u.path = []
        u.dest = null
      }
    }
    if (def.harvester) this.harvest(u, dt)
    this.move(u, dt)
    if (w) this.aimAndFire(u, dt)
    if (u.order === 'unload' && !u.dest && !u.path.length) {
      if (!this.unloadHere(u, u.unloadAt)) this.msg('Kein Ufer in Reichweite zum Entladen', 'warn', u.owner)
      u.order = 'idle'
      u.unloadAt = null
    }
    // wakes behind boats, dust behind vehicles off the road
    if (u.moving && u.speedNow > 0.4) {
      u.wakeT -= dt
      if (u.wakeT <= 0) {
        if (u.naval) {
          u.wakeT = 0.07
          const back = u.radius * 0.9
          const bx = u.x - Math.cos(u.dir) * back, by = u.y - Math.sin(u.dir) * back
          const side = (this.rand() - 0.5) * u.radius * 0.8
          this.addFx('wake', bx - Math.sin(u.dir) * side, by + Math.cos(u.dir) * side, 0, -Math.cos(u.dir) * 0.3, -Math.sin(u.dir) * 0.3, 0, 1.4 + u.radius, u.radius > 0.7 ? 3 : 2)
          this.addFx('wake', u.x + Math.cos(u.dir) * u.radius * 0.8, u.y + Math.sin(u.dir) * u.radius * 0.8, 0, -Math.sin(u.dir) * 0.5, Math.cos(u.dir) * 0.5, 0, 0.6, 1)
        } else if (!u.air && !def.infantry) {
          u.wakeT = 0.18
          const t = this.map.ter[this.map.idx(Math.floor(u.x), Math.floor(u.y))]
          if (t !== Ter.Road && t !== Ter.Bridge && t !== Ter.Grass) this.addFx('dust', u.x - Math.cos(u.dir) * 0.4, u.y - Math.sin(u.dir) * 0.4, 1, 0, 0, 3, 0.9, 1)
        }
      }
    }
    // arriving ends a move order
    if (!u.dest && !u.path.length) {
      if (u.order === 'move' || (u.order === 'amove' && !u.target)) {
        u.order = 'idle'
        u.amove = null
        u.guard = { x: u.x, y: u.y }
      }
    }
    // helicopters climb after take-off and stay up
    if (u.air && !def.jet) {
      const want = 30
      u.z += Math.sign(want - u.z) * Math.min(Math.abs(want - u.z), dt * 14)
    }
  }

  mountsTurret(u: Ent): boolean {
    const d = u.u!
    return !d.infantry && !d.harvester && !d.air && !d.transport && !d.carrier
  }

  // ─────────────────────────────────────────────────────── jets and carriers

  /** where a jet comes down: its slot on the airfield, or the carrier's deck */
  private jetHome(u: Ent): { x: number; y: number; b: Ent } | null {
    let h = this.byId.get(u.home)
    if (h && !h.dead) {
      if (h.isB) return { ...this.slotPos(h, u.slot), b: h }
      return { x: h.x, y: h.y, b: h }
    }
    // home is gone: any free slot or carrier with room
    const spot = this.freeSlot(u.owner, u)
    if (spot) {
      u.home = spot.b.id
      u.slot = spot.s
      return { ...this.slotPos(spot.b, spot.s), b: spot.b }
    }
    for (const c of this.ents) {
      if (c.dead || c.owner !== u.owner || !c.u?.carrier) continue
      const out = this.ents.filter((j) => j.jet && !j.dead && j.home === c.id).length
      if (c.planes + out < c.u.carrier) {
        u.home = c.id
        u.slot = -1
        h = c
        return { x: c.x, y: c.y, b: c }
      }
    }
    return null
  }

  private fly(u: Ent, tx: number, ty: number, dt: number, speed: number, alt: number) {
    const def = u.u!
    const want = Math.atan2(ty - u.y, tx - u.x)
    u.dir = turnTo(u.dir, want, def.turn * dt)
    u.tdir = u.dir
    u.jspeed += Math.sign(speed - u.jspeed) * Math.min(Math.abs(speed - u.jspeed), dt * 4)
    u.x += Math.cos(u.dir) * u.jspeed * dt
    u.y += Math.sin(u.dir) * u.jspeed * dt
    const N = this.map.N
    u.x = Math.max(-4, Math.min(N + 4, u.x))
    u.y = Math.max(-4, Math.min(N + 4, u.y))
    u.z += Math.sign(alt - u.z) * Math.min(Math.abs(alt - u.z), dt * 22)
    u.moving = true
  }

  private updateJet(u: Ent, dt: number) {
    const def = u.u!
    u.anim += dt
    switch (u.js) {
      case 'park': {
        u.moving = false
        u.jspeed = 0
        u.z = 0
        const h = this.byId.get(u.home)
        if (!h || h.dead) {
          // the airfield is gone: fly to another one if there is one
          if (this.jetHome(u)) u.js = 'back'
          else this.kill(u, -1)
          return
        }
        if (u.ammo < 1) {
          const low = this.players[u.owner].powerUse > this.players[u.owner].powerProd
          u.rearm += dt * (low ? 0.5 : 1)
          if (u.rearm >= 6) {
            u.ammo = 1
            u.rearm = 0
            if (u.owner === 0) this.msg(`${def.name} wieder einsatzbereit`, 'good')
          }
        }
        return
      }
      case 'out': {
        const s = u.strike
        if (!s || (s.e && s.e.dead)) {
          u.js = 'back'
          return
        }
        const tx = s.e ? s.e.x : s.x, ty = s.e ? s.e.y : s.y
        this.fly(u, tx, ty, dt, def.speed, 34)
        // the volley
        if (u.burst > 0) {
          u.burstT -= dt
          if (u.burstT <= 0) {
            u.burstT = def.weapon!.gap ?? 0.2
            u.burst--
            this.fireAt(u, s.e, tx, ty)
            if (u.burst === 0) {
              u.ammo = 0
              u.js = 'back'
              u.strike = null
              u.order = 'idle'
            }
          }
          return
        }
        const d = Math.hypot(tx - u.x, ty - u.y)
        const off = Math.abs(angDiff(u.dir, Math.atan2(ty - u.y, tx - u.x)))
        if (u.ammo >= 1 && d < def.weapon!.range && d > 1.5 && off < 0.3 && u.z > 20) {
          u.burst = def.weapon!.burst ?? 1
          u.burstT = 0
        }
        return
      }
      case 'back': {
        const h = this.jetHome(u)
        if (!h) {
          // nowhere to land: it circles until the fuel runs out
          u.rearm += dt
          this.fly(u, u.x + Math.cos(u.dir + 0.5), u.y + Math.sin(u.dir + 0.5), dt, def.speed * 0.8, 34)
          if (u.rearm > 25) this.kill(u, -1)
          return
        }
        this.fly(u, h.x, h.y, dt, def.speed, 30)
        if (Math.hypot(h.x - u.x, h.y - u.y) < 3) u.js = 'land'
        return
      }
      case 'land': {
        const h = this.jetHome(u)
        if (!h) {
          u.js = 'back'
          return
        }
        const d = Math.hypot(h.x - u.x, h.y - u.y)
        const want = Math.atan2(h.y - u.y, h.x - u.x)
        u.jspeed = Math.max(0.6, Math.min(def.speed * 0.5, d * 2))
        if (d > 0.1) u.dir = turnTo(u.dir, want, def.turn * 2 * dt)
        const step = Math.min(d, u.jspeed * dt)
        u.x += Math.cos(want) * step
        u.y += Math.sin(want) * step
        const deck = h.b.isB ? 0 : 6
        u.z = Math.max(deck, Math.min(u.z, deck + d * 9))
        if (d < 0.12) {
          if (!h.b.isB) {
            // stowed below deck
            h.b.planes++
            u.dead = true
            u.selected = false
            this.byId.delete(u.id)
            return
          }
          u.js = 'park'
          u.z = 0
          u.dir = u.tdir = Math.PI / 2
          u.moving = false
        }
        return
      }
    }
  }

  /** a carrier rebuilds lost jets and sends them at anything in reach */
  private carrierDeck(u: Ent, dt: number) {
    const cap = u.u!.carrier!
    const out = this.ents.filter((j) => j.jet && !j.dead && j.home === u.id).length
    if (u.planes + out < cap) {
      u.planeT += dt
      if (u.planeT > 22) {
        u.planeT = 0
        u.planes++
      }
    }
    u.launchT -= dt
    if (u.planes <= 0 || u.launchT > 0) return
    u.launchT = 1
    // the nearest enemy on land or water it can see
    let best: Ent | null = null
    let bd = 17
    for (const e of this.ents) {
      if (e.dead || e.owner === u.owner || e.air || e.carriedBy) continue
      const d = Math.hypot(e.x - u.x, e.y - u.y)
      if (d < bd && this.visibleTo(u.owner, e)) {
        bd = d
        best = e
      }
    }
    if (!best) return
    const j = this.addUnit(u.owner, 'jet', u.x, u.y)
    j.home = u.id
    j.slot = -1
    j.z = 6
    j.dir = j.tdir = u.dir
    j.jspeed = 3
    j.js = 'out'
    j.order = 'strike'
    j.strike = { e: best, x: best.x, y: best.y }
    u.planes--
    u.launchT = 3
    this.onSound('jet', u.x, u.y)
  }

  private harvest(u: Ent, dt: number) {
    if (u.order !== 'harvest') return
    const m = this.map
    const N = m.N
    switch (u.hs) {
      case 'toOre': {
        if (u.cargo >= HARVEST_LOAD) {
          u.hs = 'toRef'
          break
        }
        if (u.oreTile < 0 || m.ore[u.oreTile] <= 0) {
          u.oreTile = this.findOre(u.x, u.y, u)
          if (u.oreTile < 0) {
            u.hs = u.cargo > 0 ? 'toRef' : 'idle'
            if (u.hs === 'idle') this.msg('Kein Erz mehr erreichbar', 'warn', u.owner)
            break
          }
          u.path = []
          u.dest = null
        }
        const tx = (u.oreTile % N) + 0.5, ty = Math.floor(u.oreTile / N) + 0.5
        if (Math.hypot(u.x - tx, u.y - ty) < 0.55) {
          u.hs = 'mining'
          u.mineT = 0
          u.path = []
          u.dest = null
        } else if (!u.dest && !u.path.length) {
          this.setDest(u, tx, ty)
          const d = u.dest as { x: number; y: number } | null
          if (!d) u.oreTile = -1
          else if (Math.hypot(d.x - tx, d.y - ty) > 1.5) {
            // cannot reach this one: forget it for now
            u.oreTile = -1
          }
        }
        break
      }
      case 'mining': {
        u.mineT += dt
        if (this.rand() < dt * 4) this.addFx('dust', u.x + (this.rand() - 0.5) * 0.4, u.y + (this.rand() - 0.5) * 0.4, 2, 0, 0, 4, 0.8, 2)
        if (u.mineT >= 0.5) {
          u.mineT = 0
          const take = Math.min(50, m.ore[u.oreTile], HARVEST_LOAD - u.cargo)
          m.ore[u.oreTile] -= take
          u.cargo += take
          if (m.ore[u.oreTile] <= 0) {
            m.ore[u.oreTile] = 0
            m.ter[u.oreTile] = Ter.Dirt
            this.oreChanged.push(u.oreTile)
          }
          if (u.cargo >= HARVEST_LOAD) u.hs = 'toRef'
          else if (m.ore[u.oreTile] <= 0) u.hs = 'toOre'
        }
        break
      }
      case 'toRef': {
        const ref = this.nearestRefinery(u)
        if (!ref) {
          u.hs = 'idle'
          break
        }
        const dock = this.dockOf(ref)
        if (Math.hypot(u.x - dock.x, u.y - dock.y) < 0.7) {
          u.hs = 'unload'
          u.mineT = 0
          u.path = []
          u.dest = null
        } else if (!u.dest && !u.path.length) this.setDest(u, dock.x, dock.y)
        break
      }
      case 'unload': {
        u.mineT += dt
        const rate = HARVEST_LOAD / 2.2
        const give = Math.min(u.cargo, rate * dt)
        const pl = this.players[u.owner]
        const mult = pl.ai ? [0.75, 1, 1.3][this.opts.difficulty] : 1
        u.cargo -= give
        pl.credits += give * mult
        pl.stats.harvested += give * mult
        if (u.cargo <= 0.01) {
          u.cargo = 0
          u.hs = 'toOre'
        }
        break
      }
      case 'idle':
        if (this.rand() < dt * 0.2) u.hs = u.cargo > 0 ? 'toRef' : 'toOre'
        break
    }
  }

  dockOf(ref: Ent): { x: number; y: number } {
    const w = this.pf.nearestWalkable(ref.tx + ref.w + 0.5, ref.ty + ref.h - 0.5, 4)
    return w ? { x: w.x + 0.5, y: w.y + 0.5 } : { x: ref.tx + ref.w + 0.5, y: ref.ty + ref.h - 0.5 }
  }

  nearestRefinery(u: Ent): Ent | null {
    let best: Ent | null = null
    let bd = 1e9
    for (const e of this.ents) {
      if (!e.isB || e.dead || e.owner !== u.owner || e.key !== 'ref' || e.built < 1) continue
      const d = Math.hypot(e.x - u.x, e.y - u.y)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    return best
  }

  /** the nearest ore that few other trucks are heading for */
  findOre(x: number, y: number, self: Ent): number {
    const m = this.map
    const N = m.N
    let best = -1
    let bd = 1e9
    const taken = new Map<number, number>()
    for (const e of this.ents) if (e !== self && e.u?.harvester && e.oreTile >= 0) taken.set(e.oreTile, (taken.get(e.oreTile) ?? 0) + 1)
    const cx = Math.floor(x), cy = Math.floor(y)
    for (let r = 0; r < 40; r++) {
      if (best >= 0 && r > bd + 2) break
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const tx = cx + dx, ty = cy + dy
          if (!m.inMap(tx, ty)) continue
          const i = m.idx(tx, ty)
          if (m.ore[i] <= 0 || !m.walkI(i)) continue
          const d = Math.hypot(dx, dy) + (taken.get(i) ?? 0) * 3
          if (d < bd) {
            bd = d
            best = i
          }
        }
    }
    return best
  }

  // ─────────────────────────────────────────────────────── moving

  private move(u: Ent, dt: number) {
    const m = this.map
    const N = m.N
    const def = u.u!
    let tx: number, ty: number
    if (u.air) {
      if (!u.dest) {
        u.moving = false
        u.speedNow = 0
        // hover in place, turning slowly to face a target
        if (u.target) u.dir = turnTo(u.dir, Math.atan2(u.target.y - u.y, u.target.x - u.x), def.turn * dt)
        return
      }
      tx = u.dest.x
      ty = u.dest.y
      const d = Math.hypot(tx - u.x, ty - u.y)
      if (d < 0.15) {
        u.dest = null
        u.moving = false
        return
      }
      const want = Math.atan2(ty - u.y, tx - u.x)
      u.dir = turnTo(u.dir, want, def.turn * dt)
      const sp = def.speed * (u.z < 20 ? 0.4 : 1)
      const step = Math.min(d, sp * dt)
      const a = Math.abs(angDiff(u.dir, want)) < 1.2 ? 1 : 0.3
      u.x += Math.cos(want) * step * a
      u.y += Math.sin(want) * step * a
      u.x = Math.max(0.5, Math.min(N - 0.5, u.x))
      u.y = Math.max(0.5, Math.min(N - 0.5, u.y))
      u.moving = true
      return
    }
    if (u.pi < u.path.length) {
      const i = u.path[u.pi]
      const last = u.pi === u.path.length - 1
      if (last && u.dest) {
        tx = u.dest.x
        ty = u.dest.y
      } else {
        tx = (i % N) + 0.5
        ty = Math.floor(i / N) + 0.5
      }
      const d = Math.hypot(tx - u.x, ty - u.y)
      if (d < (last ? 0.08 : 0.3)) {
        u.pi++
        if (u.pi >= u.path.length) {
          u.path = []
          u.dest = null
          u.moving = false
          u.speedNow = 0
        }
        return
      }
      const want = Math.atan2(ty - u.y, tx - u.x)
      let k = 1
      if (def.turn > 0) {
        u.dir = turnTo(u.dir, want, def.turn * dt)
        const off = Math.abs(angDiff(u.dir, want))
        k = off < 0.35 ? 1 : off < 1.2 ? 0.45 : 0.05
      } else u.dir = want
      const t = m.ter[m.idx(Math.max(0, Math.min(N - 1, Math.floor(u.x))), Math.max(0, Math.min(N - 1, Math.floor(u.y))))]
      const terrain = u.naval ? 1 : t === Ter.Road || t === Ter.Bridge ? 1.25 : t === Ter.Field ? 0.92 : t === Ter.Sand ? 0.85 : 1
      const target = def.speed * terrain * k
      u.speedNow += (target - u.speedNow) * Math.min(1, dt * (def.infantry ? 10 : 3))
      const step = Math.min(d, u.speedNow * dt)
      const dx = Math.cos(def.turn > 0 ? u.dir : want) * step
      const dy = Math.sin(def.turn > 0 ? u.dir : want) * step
      this.tryMove(u, dx, dy)
      u.moving = true
      // stuck?
      u.stuckT += dt
      if (u.stuckT > 1.6) {
        const moved = Math.hypot(u.x - u.stuckX, u.y - u.stuckY)
        u.stuckT = 0
        u.stuckX = u.x
        u.stuckY = u.y
        if (moved < 0.25) {
          u.repaths++
          const goal = u.dest ?? { x: (u.path[u.path.length - 1] % N) + 0.5, y: Math.floor(u.path[u.path.length - 1] / N) + 0.5 }
          if (u.repaths > 3 || Math.hypot(goal.x - u.x, goal.y - u.y) < 1.6) {
            u.path = []
            u.dest = null
            u.moving = false
          } else {
            const keep = u.repaths
            this.setDest(u, goal.x, goal.y)
            u.repaths = keep
          }
        }
      }
    } else {
      u.moving = false
      u.speedNow = 0
    }
  }

  private tryMove(u: Ent, dx: number, dy: number) {
    const m = this.map
    const r = Math.min(0.3, u.u!.radius)
    const pass = u.naval ? (x: number, y: number) => m.nav(x, y) : (x: number, y: number) => m.walk(x, y)
    const ok = (x: number, y: number) =>
      pass(Math.floor(x - r * 0.7), Math.floor(y - r * 0.7)) && pass(Math.floor(x + r * 0.7), Math.floor(y + r * 0.7)) &&
      pass(Math.floor(x - r * 0.7), Math.floor(y + r * 0.7)) && pass(Math.floor(x + r * 0.7), Math.floor(y - r * 0.7))
    const nx = u.x + dx, ny = u.y + dy
    if (ok(nx, ny)) {
      u.x = nx
      u.y = ny
    } else if (ok(nx, u.y)) u.x = nx
    else if (ok(u.x, ny)) u.y = ny
    else if (!pass(Math.floor(u.x), Math.floor(u.y))) {
      // inside something (a building went up on top): get out
      const w = this.pfOf(u).nearestWalkable(u.x, u.y)
      if (w) {
        u.x = w.x + 0.5
        u.y = w.y + 0.5
      }
    }
  }

  private buildSpatial() {
    const n = this.ents.length
    if (this.next.length < n) this.next = new Int32Array(n * 2)
    this.head.fill(-1)
    this.list = this.ents
    const N = this.map.N
    for (let i = 0; i < n; i++) {
      const e = this.ents[i]
      if (e.isB || e.dead || e.air || e.carriedBy) {
        this.next[i] = -2
        continue
      }
      const t = Math.max(0, Math.min(N - 1, Math.floor(e.y))) * N + Math.max(0, Math.min(N - 1, Math.floor(e.x)))
      this.next[i] = this.head[t]
      this.head[t] = i
    }
  }

  /** units push each other apart, the moving ones yield less than the waiting ones */
  private separate(dt: number) {
    const N = this.map.N
    const list = this.list
    for (let i = 0; i < list.length; i++) {
      const a = list[i]
      if (a.isB || a.dead || a.air || a.carriedBy) continue
      const cx = Math.floor(a.x), cy = Math.floor(a.y)
      const reach = a.naval ? 2 : 1
      for (let ty = cy - reach; ty <= cy + reach; ty++) {
        if (ty < 0 || ty >= N) continue
        for (let tx = cx - reach; tx <= cx + reach; tx++) {
          if (tx < 0 || tx >= N) continue
          for (let j = this.head[ty * N + tx]; j >= 0; j = this.next[j]) {
            if (j <= i) continue
            const b = list[j]
            if (b.dead || b.naval !== a.naval) continue
            const dx = b.x - a.x, dy = b.y - a.y
            const d = Math.hypot(dx, dy)
            const min = (a.u!.radius + b.u!.radius) * (a.u!.infantry && b.u!.infantry ? 0.9 : 1)
            if (d >= min || d < 1e-4) {
              if (d < 1e-4) {
                b.x += 0.01
              }
              continue
            }
            const push = Math.min(0.5, (min - d) * 0.5) * Math.min(1, dt * 12)
            const ux = dx / d, uy = dy / d
            const wa = a.moving && !b.moving ? 0.3 : !a.moving && b.moving ? 0.7 : 0.5
            this.tryMove(a, -ux * push * 2 * wa, -uy * push * 2 * wa)
            this.tryMove(b, ux * push * 2 * (1 - wa), uy * push * 2 * (1 - wa))
          }
        }
      }
    }
  }

  // ─────────────────────────────────────────────────────── fighting

  /** distance from an attacker to the nearest part of a target */
  dist(a: Ent, t: Ent): number {
    if (t.isB) {
      const dx = Math.max(t.tx - a.x, 0, a.x - (t.tx + t.w))
      const dy = Math.max(t.ty - a.y, 0, a.y - (t.ty + t.h))
      return Math.hypot(dx, dy)
    }
    return Math.max(0, Math.hypot(t.x - a.x, t.y - a.y) - t.radius * 0.5)
  }

  visibleTo(p: number, e: Ent): boolean {
    if (e.owner === p) return true
    if (e.carriedBy) return false
    // a sniper keeping still is only seen from close by
    if (e.hidden) {
      let near = false
      for (const o of this.ents) {
        if (o.owner !== p || o.dead || o.isB || o.carriedBy) continue
        if (Math.hypot(o.x - e.x, o.y - e.y) < 2.2) {
          near = true
          break
        }
      }
      if (!near) return false
    }
    if (p === 0) {
      const N = this.map.N
      if (e.isB) {
        for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (this.fog[this.map.idx(x, y)] === 2) return true
        return false
      }
      const tx = Math.floor(e.x), ty = Math.floor(e.y)
      if (tx < 0 || ty < 0 || tx >= N || ty >= N) return false
      return this.fog[ty * N + tx] === 2
    }
    // the computer sees what its units and buildings see
    for (const o of this.ents) {
      if (o.owner !== p || o.dead || o.carriedBy) continue
      if (Math.hypot(o.x - e.x, o.y - e.y) <= o.sight + (e.isB ? e.radius : 0)) return true
    }
    return false
  }

  findTarget(u: Ent, range: number): Ent | null {
    const w = u.weapon
    if (!w) return null
    let best: Ent | null = null
    let bs = 1e9
    for (const e of this.ents) {
      if (e.dead || e.owner === u.owner || e.carriedBy) continue
      if (!reaches(w, e)) continue
      const d = this.dist(u, e)
      if (d > range) continue
      if (w.minRange && d < w.minRange) continue
      if (!this.visibleTo(u.owner, e)) continue
      // prefer what this weapon is good against, and what shoots back
      const eff = VS[w.cls][e.isB ? 'bld' : e.u!.armor]
      const s = d - eff * 3 - (e.weapon ? 1.5 : 0) + (e.isB ? 2 : 0)
      if (s < bs) {
        bs = s
        best = e
      }
    }
    return best
  }

  private aimAndFire(u: Ent, dt: number) {
    const w = u.weapon!
    u.cd -= dt
    const t = u.target
    if (u.burst > 0) {
      u.burstT -= dt
      if (u.burstT <= 0 && t && !t.dead) {
        u.burst--
        u.burstT = w.gap ?? 0.1
        this.fireAt(u, t, t.x, t.y)
      } else if (!t || t.dead) u.burst = 0
      return
    }
    if (!t) {
      // turrets drift back to the front
      if (!u.isB && this.mountsTurret(u) && !u.moving) u.tdir = turnTo(u.tdir, u.dir, dt * 1.5)
      else if (!u.isB && this.mountsTurret(u)) u.tdir = turnTo(u.tdir, u.dir, dt * 2.5)
      return
    }
    const d = this.dist(u, t)
    const want = Math.atan2(t.y - u.y, t.x - u.x)
    let aligned: boolean
    // missiles leave their cells straight up, so a ship need not turn for them
    const vertical = w.proj === 'missile'
    if (u.isB || this.mountsTurret(u)) {
      u.tdir = turnTo(u.tdir, want, dt * (u.key === 'art' ? 1.4 : 3.2))
      aligned = vertical || Math.abs(angDiff(u.tdir, want)) < 0.12
    } else if (u.u!.infantry) {
      if (!u.moving) u.dir = want
      aligned = !u.moving
      u.tdir = u.dir
    } else if (u.naval) {
      aligned = true
      u.tdir = u.dir
    } else {
      // no turret: the whole thing turns (helicopters)
      if (!u.moving || u.air) u.dir = turnTo(u.dir, want, dt * (u.u!.turn || 4))
      aligned = Math.abs(angDiff(u.dir, want)) < 0.2
      u.tdir = u.dir
    }
    if (d > w.range || (w.minRange && d < w.minRange)) return
    if (!aligned || u.cd > 0) return
    if (!u.isB && u.u!.infantry && u.moving) return
    u.cd = w.reload * (0.92 + this.rand() * 0.16)
    u.burst = (w.burst ?? 1) - 1
    u.burstT = w.gap ?? 0.1
    this.fireAt(u, t, t.x, t.y)
  }

  /** one shot from a unit at a target, or at a point on the ground */
  fireAt(u: Ent, t: Ent | null, tx: number, ty: number) {
    const w = u.weapon!
    const yaw = u.isB || this.mountsTurret(u) ? u.tdir : u.dir
    const mz = u.isB ? (u.key === 'bunker' ? 7 : 4) : u.air ? u.z : u.u!.infantry ? 5 : u.naval ? 9 : 7
    const along = u.isB ? 0.3 : u.u!.infantry ? 0.25 : u.jet ? 0.2 : u.radius * 0.8 + 0.15
    const side = w.burst && w.burst > 1 && !u.u?.infantry ? (u.burst % 2 ? 0.2 : -0.2) : 0
    const x0 = u.x + Math.cos(yaw) * along - Math.sin(yaw) * side
    const y0 = u.y + Math.sin(yaw) * along + Math.cos(yaw) * side
    let x1 = t ? t.x : tx, y1 = t ? t.y : ty
    const z1 = t ? (t.air ? t.z : t.isB ? 8 : t.naval ? 5 : 3) : 0
    // artillery and missiles at a point are not exact
    if (w.proj === 'art' || w.proj === 'mlrs' || (!t && w.proj === 'missile')) {
      const spread = w.proj === 'mlrs' ? 1.2 : 0.5
      x1 += (this.rand() - 0.5) * spread * 2
      y1 += (this.rand() - 0.5) * spread * 2
    } else if (t && t.isB) {
      x1 += (this.rand() - 0.5) * t.w * 0.6
      y1 += (this.rand() - 0.5) * t.h * 0.6
    }
    const dist = Math.hypot(x1 - x0, y1 - y0)
    const SPEED: Record<string, number> = { bullet: 26, flak: 24, shell: 20, rocket: 9, art: 7, mlrs: 8, missile: 8, snipe: 40 }
    const T = Math.max(0.05, dist / SPEED[w.proj] + (w.proj === 'art' ? 0.6 : 0))
    const lob = w.proj === 'missile' && !u.air
    this.shots.push({
      kind: w.proj, owner: u.owner, x0, y0, z0: mz, x1, y1, z1,
      target: w.proj === 'art' || w.proj === 'mlrs' ? null : t,
      t: 0, T,
      arc: w.proj === 'art' ? dist * 9 + 20 : w.proj === 'mlrs' ? dist * 6 + 16 : lob ? dist * 4 + 30 : w.proj === 'rocket' ? 4 : 0,
      dmg: w.dmg * (1 + 0.12 * u.rank), cls: w.cls, splash: w.splash ?? 0, trailT: 0, src: u.id,
    })
    u.firedT = this.time
    // muzzle flash
    const heavy = w.proj === 'art' || w.proj === 'shell' || w.proj === 'missile'
    this.addFx('flash', x0, y0, mz, 0, 0, 0, w.proj === 'art' ? 0.18 : 0.08, heavy ? 3 : w.proj === 'snipe' ? 1 : 1.5)
    if (heavy) this.addFx('smoke', x0, y0, mz, 0, 0, 6, 1.4, w.proj === 'art' || w.proj === 'missile' ? 4 : 2)
    this.onSound(w.proj, u.x, u.y)
    if (!u.isB && !u.u!.infantry && !u.jet) u.speedNow *= 0.85
  }

  private updateShots(dt: number) {
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const s = this.shots[i]
      s.t += dt
      if (s.target && !s.target.dead) {
        s.x1 = s.target.x
        s.y1 = s.target.y
        if (s.target.air) s.z1 = s.target.z
      }
      if (s.kind === 'rocket' || s.kind === 'mlrs' || s.kind === 'missile') {
        s.trailT -= dt
        if (s.trailT <= 0) {
          s.trailT = s.kind === 'missile' ? 0.03 : 0.04
          const p = this.shotPos(s)
          this.addFx('smoke', p.x, p.y, p.z, 0, 0, 3, s.kind === 'missile' ? 1.1 : 0.7, 1)
        }
      }
      if (s.t >= s.T) {
        this.shots.splice(i, 1)
        this.impact(s)
      }
    }
  }

  shotPos(s: Shot): { x: number; y: number; z: number } {
    const p = Math.min(1, s.t / s.T)
    return {
      x: s.x0 + (s.x1 - s.x0) * p,
      y: s.y0 + (s.y1 - s.y0) * p,
      z: s.z0 + (s.z1 - s.z0) * p + s.arc * 4 * p * (1 - p),
    }
  }

  private wet(x: number, y: number): boolean {
    return this.map.nav(Math.floor(x), Math.floor(y)) && this.map.ter[this.map.idx(Math.floor(x), Math.floor(y))] === Ter.Water
  }

  private impact(s: Shot) {
    const big = s.kind === 'art' || s.kind === 'mlrs' || s.kind === 'missile'
    const water = this.wet(s.x1, s.y1)
    if (s.splash > 0) {
      for (const e of this.ents) {
        if (e.dead || e.air || e.carriedBy) continue
        const d = e.isB ? this.distPt(e, s.x1, s.y1) : Math.hypot(e.x - s.x1, e.y - s.y1)
        if (d > s.splash) continue
        this.damage(e, s.dmg * (1 - (d / s.splash) * 0.6), s.cls, s.owner, s.src)
      }
      const shipHit = this.ents.some((e) => e.naval && !e.dead && Math.hypot(e.x - s.x1, e.y - s.y1) < e.radius + 0.3)
      if (water && !shipHit) this.addFx('splash', s.x1, s.y1, 0, 0, 0, 0, 0.9, big ? 2 : 1)
      else {
        this.addFx('exp', s.x1, s.y1, 2, 0, 0, 0, 0.6, big ? 1 : 0)
        if (big && !water) {
          this.stamps.push({ kind: 'scorch', size: 0, x: s.x1, y: s.y1 })
          for (let k = 0; k < 4; k++) this.addFx('debris', s.x1, s.y1, 2, (this.rand() - 0.5) * 2, (this.rand() - 0.5) * 2, 20 + this.rand() * 20, 0.8, 1)
        }
      }
      this.onSound('boom', s.x1, s.y1)
      return
    }
    const t = s.target
    if (t && !t.dead) {
      this.damage(t, s.dmg, s.cls, s.owner, s.src)
      if (s.kind === 'shell' || s.kind === 'rocket') {
        this.addFx('exp', s.x1, s.y1, s.z1, 0, 0, 0, 0.4, 0)
        this.onSound('hit', s.x1, s.y1)
      } else this.addFx('spark', s.x1, s.y1, s.z1, 0, 0, 6, 0.25, 1)
    } else if (water) {
      this.addFx('splash', s.x1, s.y1, 0, 0, 0, 0, 0.6, 0)
    } else {
      this.addFx(s.kind === 'shell' || s.kind === 'rocket' ? 'exp' : 'dust', s.x1, s.y1, 1, 0, 0, 3, 0.4, s.kind === 'shell' || s.kind === 'rocket' ? 0 : 2)
    }
  }

  private distPt(b: Ent, x: number, y: number): number {
    const dx = Math.max(b.tx - x, 0, x - (b.tx + b.w))
    const dy = Math.max(b.ty - y, 0, y - (b.ty + b.h))
    return Math.hypot(dx, dy)
  }

  damage(e: Ent, dmg: number, cls: WClass, from: number, src = 0) {
    if (e.dead || e.owner === from || e.carriedBy) return
    const armor = e.isB ? 'bld' : e.u!.armor
    const d = dmg * VS[cls][armor] * (0.9 + this.rand() * 0.2) * (1 - 0.07 * e.rank)
    e.hp -= d
    e.lastHit = this.time
    e.flashT = this.time
    // under fire: those near it come to help
    if (e.owner === 0 && this.time - this.alertT > 20) {
      this.alertT = this.time
      this.msg(e.isB ? 'Unsere Basis wird angegriffen!' : 'Unsere Einheiten werden angegriffen!', 'warn')
      this.onSound('alert', e.x, e.y)
    }
    const shooter = this.byId.get(src)
    const attacker = shooter && !shooter.dead ? shooter : this.nearestEnemyShooter(e, from)
    if (attacker) e.lastAttacker = attacker
    if (!e.isB && e.order === 'idle' && !e.target && attacker && e.weapon && this.canHit(e, attacker)) e.target = attacker
    if (e.hp <= 0) this.kill(e, from, src)
  }

  private nearestEnemyShooter(e: Ent, from: number): Ent | null {
    let best: Ent | null = null
    let bd = 1e9
    for (const o of this.ents) {
      if (o.dead || o.owner !== from || !o.weapon || o.target !== e) continue
      const d = Math.hypot(o.x - e.x, o.y - e.y)
      if (d < bd) {
        bd = d
        best = o
      }
    }
    return best
  }

  kill(e: Ent, by: number, src = 0) {
    if (e.dead) return
    this.players[e.owner].stats.lost++
    if (by >= 0) this.players[by].stats.killed++
    // the shooter earns its stripes
    const killer = this.byId.get(src)
    if (killer && !killer.dead && !killer.isB) {
      killer.kills++
      const rank = RANKS.filter((k) => killer.kills >= k).length
      if (rank > killer.rank) {
        killer.rank = rank
        killer.hp = Math.min(killer.maxHp, killer.hp + killer.maxHp * 0.25)
        if (killer.owner === 0) this.msg(`${killer.u!.name} befördert: ${RANK_NAME[rank]}`, 'good')
        this.onSound('promote', killer.x, killer.y)
      }
    }
    if (e.isB) {
      this.removeBuilding(e, true)
      return
    }
    e.dead = true
    e.selected = false
    this.byId.delete(e.id)
    // whoever was aboard goes down with the ship
    for (const p of e.passengers) {
      p.dead = true
      this.byId.delete(p.id)
      this.players[p.owner].stats.lost++
    }
    e.passengers = []
    if (e.u!.infantry) {
      this.addFx('dust', e.x, e.y, 2, 0, 0, 2, 0.6, 2)
      this.onSound('scream', e.x, e.y)
      return
    }
    const z = e.air ? e.z : e.naval ? 6 : 4
    this.addFx('exp', e.x, e.y, z, 0, 0, 0, 0.75, e.naval && e.radius > 0.7 ? 2 : 1)
    for (let k = 0; k < 6; k++) this.addFx('debris', e.x, e.y, z + 4, (this.rand() - 0.5) * 3, (this.rand() - 0.5) * 3, 25 + this.rand() * 25, 1, 1)
    const water = this.wet(e.x, e.y)
    if (e.jet || (e.air && water)) {
      if (water) this.addFx('splash', e.x, e.y, 0, 0, 0, 0, 1, 2)
    } else {
      if (!e.naval && !water) this.stamps.push({ kind: 'scorch', size: 1, x: e.x, y: e.y })
      this.wrecks.push({ key: e.key, owner: e.owner, x: e.x, y: e.y, dir: e.dir, tdir: e.tdir, t: 0, air: e.air, naval: e.naval })
    }
    this.onSound('explode', e.x, e.y)
  }

  removeBuilding(e: Ent, destroyed: boolean) {
    e.dead = true
    e.selected = false
    this.byId.delete(e.id)
    for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (this.map.bld[this.map.idx(x, y)] === e.id) this.map.bld[this.map.idx(x, y)] = 0
    if (destroyed) {
      for (let k = 0; k < 3 + e.w * 2; k++) {
        const x = e.tx + this.rand() * e.w, y = e.ty + this.rand() * e.h
        this.addFx('exp', x, y, 4 + this.rand() * 10, 0, 0, 0, 0.75, e.w >= 3 ? 2 : 1)
        this.fx[this.fx.length - 1].t = -this.rand() * 0.8
      }
      for (let k = 0; k < 10; k++) this.addFx('debris', e.x, e.y, 10, (this.rand() - 0.5) * 4, (this.rand() - 0.5) * 4, 30 + this.rand() * 30, 1.2, 1)
      this.stamps.push({ kind: 'rubble', size: Math.min(3, e.w), x: e.x, y: e.y })
      this.msg(`${e.b!.name} zerstört`, e.owner === 0 ? 'warn' : 'good')
      this.onSound('collapse', e.x, e.y)
    }
    this.updatePower()
  }

  // ─────────────────────────────────────────────────────── effects and fog

  addFx(kind: FxKind, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number) {
    if (this.fx.length > 900) return
    this.fx.push({ kind, x, y, z, vx, vy, vz, t: 0, life, size })
  }

  private updateFx(dt: number) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      const f = this.fx[i]
      f.t += dt
      if (f.t < 0) continue
      f.x += f.vx * dt
      f.y += f.vy * dt
      f.z += f.vz * dt
      if (f.kind === 'debris') {
        f.vz -= 70 * dt
        if (f.z < 0) {
          f.z = 0
          f.vz *= -0.3
          f.vx *= 0.5
          f.vy *= 0.5
        }
      } else if (f.kind === 'smoke') {
        f.vx += 0.12 * dt // a light wind
      }
      if (f.t >= f.life) this.fx.splice(i, 1)
    }
  }

  /** debugging: lift the fog */
  reveal = false

  updateFog() {
    const m = this.map
    const N = m.N
    const fog = this.fog
    if (this.reveal) {
      fog.fill(2)
      this.fogDirty = true
      return
    }
    for (let i = 0; i < fog.length; i++) if (fog[i] === 2) fog[i] = 1
    for (const e of this.ents) {
      if (e.owner !== 0 || e.dead || e.carriedBy) continue
      const r = e.sight + (e.isB ? e.radius : 0)
      const cx = e.x, cy = e.y
      const r2 = r * r
      for (let y = Math.max(0, Math.floor(cy - r)); y <= Math.min(N - 1, Math.ceil(cy + r)); y++)
        for (let x = Math.max(0, Math.floor(cx - r)); x <= Math.min(N - 1, Math.ceil(cx + r)); x++) {
          const dx = x + 0.5 - cx, dy = y + 0.5 - cy
          if (dx * dx + dy * dy <= r2) fog[y * N + x] = 2
        }
    }
    this.fogDirty = true
  }
}

export function angDiff(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2)
  if (d > Math.PI) d -= Math.PI * 2
  if (d < -Math.PI) d += Math.PI * 2
  return d
}

export function turnTo(a: number, b: number, step: number): number {
  const d = angDiff(a, b)
  if (Math.abs(d) <= step) return b
  return a + Math.sign(d) * step
}
