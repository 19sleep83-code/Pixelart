// The state of a battle and everything that changes it: units driving and fighting, shells in
// the air, buildings going up, ore being hauled, money and power, and the fog over the map.

import { GameMap, Ter, generateMap } from './map'
import { PathFinder } from './path'
import {
  unitDefs, buildingDefs, VS, START_CREDITS, HARVEST_LOAD, BUILD_RADIUS,
  type UnitDef, type BuildingDef, type WeaponDef, type Queue, type Proj, type WClass,
} from './defs'
import type { Faction } from './colors'
import { mulberry32 } from '../core/rng'

export type Order = 'idle' | 'move' | 'attack' | 'amove' | 'harvest'
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
}

export type FxKind = 'exp' | 'smoke' | 'fire' | 'flash' | 'spark' | 'dust' | 'debris'
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
}

export interface Msg {
  text: string
  t: number
  kind: 'info' | 'warn' | 'good'
}

export interface GameOpts {
  seed: number
  faction: Faction
  difficulty: 0 | 1 | 2
}

const QUEUE_PRODUCER: Record<Queue, string> = { build: 'hq', inf: 'barracks', veh: 'factory', air: 'helipad' }

export class Game {
  map: GameMap
  pf: PathFinder
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
    this.map = generateMap(opts.seed)
    this.pf = new PathFinder(this.map)
    this.fog = new Uint8Array(this.map.N * this.map.N)
    this.head = new Int32Array(this.map.N * this.map.N)
    const enemy: Faction = opts.faction === 'nato' ? 'ru' : 'nato'
    // the NATO side always starts in the west
    const factions: Faction[] = [opts.faction, enemy]
    for (let i = 0; i < 2; i++) {
      const f = factions[i]
      this.players.push({
        id: i, faction: f, ai: i === 1, credits: START_CREDITS, powerProd: 0, powerUse: 0,
        units: unitDefs(f), queues: { build: [], inf: [], veh: [], air: [] }, alive: true,
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
    if (def.air) e.order = 'move'
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
    // close enough to a building of our own
    for (const e of this.ents) {
      if (!e.isB || e.dead || e.owner !== p) continue
      const dx = Math.max(e.tx - (tx + def.w), tx - (e.tx + e.w), 0)
      const dy = Math.max(e.ty - (ty + def.h), ty - (e.ty + e.h), 0)
      if (Math.max(dx, dy) <= BUILD_RADIUS) return true
    }
    return false
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
      for (const q of ['build', 'inf', 'veh', 'air'] as Queue[]) {
        const it = pl.queues[q][0]
        if (!it || it.ready) continue
        const prod = QUEUE_PRODUCER[q]
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

  private spawnFrom(pl: Player, q: Queue, key: string): boolean {
    const prod = QUEUE_PRODUCER[q]
    const cands = this.ents.filter((e) => e.isB && !e.dead && e.owner === pl.id && e.key === prod && e.built >= 1)
    if (!cands.length) return false
    const b = cands.find((e) => e.id === pl.primary[q]) ?? cands[cands.length - 1]
    const def = pl.units[key]
    let u: Ent
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
    const ground = units.filter((u) => !u.isB && !u.air && !u.dead)
    const air = units.filter((u) => !u.isB && u.air && !u.dead)
    const slots = this.formation(x, y, ground)
    ground.forEach((u, i) => {
      const s = slots[i] ?? { x, y }
      this.setDest(u, s.x, s.y)
      u.order = attackMove ? 'amove' : 'move'
      u.amove = attackMove ? { x: s.x, y: s.y } : null
      u.target = null
      u.guard = null
      if (u.u!.harvester) u.hs = 'idle'
    })
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

  formation(x: number, y: number, units: Ent[]): { x: number; y: number }[] {
    if (!units.length) return []
    const m = this.map
    const cx = Math.floor(x), cy = Math.floor(y)
    const tiles: { x: number; y: number; d: number }[] = []
    const need = units.reduce((n, u) => n + (u.u!.infantry ? 0.34 : 1), 0)
    for (let r = 0; r < 12 && tiles.length < need * 1.2 + 1; r++)
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          if (!m.walk(cx + dx, cy + dy)) continue
          tiles.push({ x: cx + dx, y: cy + dy, d: Math.hypot(dx, dy) })
        }
    tiles.sort((a, b) => a.d - b.d)
    // vehicles take whole tiles; soldiers share them three to a tile
    const out: { x: number; y: number }[] = new Array(units.length)
    const order = units.map((u, i) => i).sort((a, b) => Math.hypot(units[a].x - x, units[a].y - y) - Math.hypot(units[b].x - x, units[b].y - y))
    const OFF = [[0.5, 0.5], [0.25, 0.3], [0.75, 0.7], [0.3, 0.75]]
    const fill = new Map<number, number>()
    let ti = 0
    for (const i of order) {
      const inf = units[i].u!.infantry
      while (ti < tiles.length) {
        const t = tiles[ti]
        const k = m.idx(t.x, t.y)
        const used = fill.get(k) ?? 0
        if (inf ? used < 3 && used !== -1 : used === 0) {
          const o = inf ? OFF[used + 1] : OFF[0]
          out[i] = { x: t.x + o[0], y: t.y + o[1] }
          fill.set(k, inf ? used + 1 : -1)
          if (!inf || used + 1 >= 3) ti++
          break
        }
        ti++
      }
      if (!out[i]) out[i] = { x, y }
    }
    return out
  }

  setDest(u: Ent, x: number, y: number) {
    u.dest = { x, y }
    u.path = this.pf.find(Math.floor(u.x), Math.floor(u.y), Math.floor(x), Math.floor(y))
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
    for (const u of units) {
      if (u.isB || u.dead || !u.weapon) continue
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

  commandStop(units: Ent[]) {
    for (const u of units) {
      if (u.isB) continue
      u.order = 'idle'
      u.target = null
      u.path = []
      u.dest = null
      u.amove = null
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

  canHit(u: Ent, t: Ent): boolean {
    const w = u.weapon
    if (!w || t.dead) return false
    return t.air ? w.air : w.ground
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
      if (w.t > 40) this.wrecks.splice(i, 1)
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
    u.anim += dt
    const def = u.u!
    const w = def.weapon
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
    // arriving ends a move order
    if (!u.dest && !u.path.length) {
      if (u.order === 'move' || (u.order === 'amove' && !u.target)) {
        u.order = 'idle'
        u.amove = null
        u.guard = { x: u.x, y: u.y }
      }
    }
    // helicopters climb after take-off and stay up
    if (u.air) {
      const want = 30
      u.z += Math.sign(want - u.z) * Math.min(Math.abs(want - u.z), dt * 14)
    }
  }

  private mountsTurret(u: Ent): boolean {
    return !u.u!.infantry && u.key !== 'harv' && u.key !== 'heli'
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
          const take = Math.min(40, m.ore[u.oreTile], HARVEST_LOAD - u.cargo)
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
      const t = m.ter[m.idx(Math.floor(u.x), Math.floor(u.y))]
      const terrain = t === Ter.Road || t === Ter.Bridge ? 1.25 : t === Ter.Field ? 0.92 : 1
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
    const ok = (x: number, y: number) =>
      m.walk(Math.floor(x - r * 0.7), Math.floor(y - r * 0.7)) && m.walk(Math.floor(x + r * 0.7), Math.floor(y + r * 0.7)) &&
      m.walk(Math.floor(x - r * 0.7), Math.floor(y + r * 0.7)) && m.walk(Math.floor(x + r * 0.7), Math.floor(y - r * 0.7))
    const nx = u.x + dx, ny = u.y + dy
    if (ok(nx, ny)) {
      u.x = nx
      u.y = ny
    } else if (ok(nx, u.y)) u.x = nx
    else if (ok(u.x, ny)) u.y = ny
    else if (!m.walk(Math.floor(u.x), Math.floor(u.y))) {
      // inside something (a building went up on top): get out
      const w = this.pf.nearestWalkable(u.x, u.y)
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
      if (e.isB || e.dead || e.air) {
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
      if (a.isB || a.dead || a.air) continue
      const cx = Math.floor(a.x), cy = Math.floor(a.y)
      for (let ty = cy - 1; ty <= cy + 1; ty++) {
        if (ty < 0 || ty >= N) continue
        for (let tx = cx - 1; tx <= cx + 1; tx++) {
          if (tx < 0 || tx >= N) continue
          for (let j = this.head[ty * N + tx]; j >= 0; j = this.next[j]) {
            if (j <= i) continue
            const b = list[j]
            if (b.dead) continue
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
    if (p === 0) {
      const i = this.map.idx(Math.max(0, Math.min(this.map.N - 1, Math.floor(e.x))), Math.max(0, Math.min(this.map.N - 1, Math.floor(e.y))))
      if (e.isB) {
        for (let y = e.ty; y < e.ty + e.h; y++) for (let x = e.tx; x < e.tx + e.w; x++) if (this.fog[this.map.idx(x, y)] === 2) return true
        return false
      }
      return this.fog[i] === 2
    }
    // the computer sees what its units and buildings see
    for (const o of this.ents) {
      if (o.owner !== p || o.dead) continue
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
      if (e.dead || e.owner === u.owner) continue
      if (e.air ? !w.air : !w.ground) continue
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
        this.fire(u, t)
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
    if (u.isB || this.mountsTurret(u)) {
      u.tdir = turnTo(u.tdir, want, dt * (u.key === 'art' ? 1.4 : 3.2))
      aligned = Math.abs(angDiff(u.tdir, want)) < 0.12
    } else if (u.u!.infantry) {
      if (!u.moving) u.dir = want
      aligned = !u.moving
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
    this.fire(u, t)
  }

  private fire(u: Ent, t: Ent) {
    const w = u.weapon!
    const yaw = u.isB || this.mountsTurret(u) ? u.tdir : u.dir
    const mz = u.isB ? (u.key === 'bunker' ? 7 : 4) : u.air ? u.z : u.u!.infantry ? 5 : 7
    const along = u.isB ? 0.3 : u.u!.infantry ? 0.25 : u.radius + 0.15
    const side = w.burst && w.burst > 1 && !u.u?.infantry ? (u.burst % 2 ? 0.18 : -0.18) : 0
    const x0 = u.x + Math.cos(yaw) * along - Math.sin(yaw) * side
    const y0 = u.y + Math.sin(yaw) * along + Math.cos(yaw) * side
    let x1 = t.x, y1 = t.y
    const z1 = t.air ? t.z : t.isB ? 8 : 3
    // artillery is not exact
    if (w.proj === 'art' || w.proj === 'mlrs') {
      const spread = w.proj === 'mlrs' ? 1.2 : 0.5
      x1 += (this.rand() - 0.5) * spread * 2
      y1 += (this.rand() - 0.5) * spread * 2
    } else if (t.isB) {
      x1 += (this.rand() - 0.5) * t.w * 0.6
      y1 += (this.rand() - 0.5) * t.h * 0.6
    }
    const dist = Math.hypot(x1 - x0, y1 - y0)
    const speed = { bullet: 26, flak: 24, shell: 20, rocket: 9, art: 7, mlrs: 8 }[w.proj]
    const T = Math.max(0.05, dist / speed + (w.proj === 'art' ? 0.6 : 0))
    this.shots.push({
      kind: w.proj, owner: u.owner, x0, y0, z0: mz, x1, y1, z1, target: w.proj === 'art' || w.proj === 'mlrs' ? null : t,
      t: 0, T, arc: w.proj === 'art' ? dist * 9 + 20 : w.proj === 'mlrs' ? dist * 6 + 16 : w.proj === 'rocket' ? 4 : 0,
      dmg: w.dmg, cls: w.cls, splash: w.splash ?? 0, trailT: 0,
    })
    // muzzle flash
    this.addFx('flash', x0, y0, mz, 0, 0, 0, w.proj === 'art' ? 0.18 : 0.08, w.proj === 'art' || w.proj === 'shell' ? 3 : 1.5)
    if (w.proj === 'art' || w.proj === 'shell') this.addFx('smoke', x0, y0, mz, 0, 0, 6, 1.4, w.proj === 'art' ? 4 : 2)
    this.onSound(w.proj, u.x, u.y)
    if (!u.isB && !u.u!.infantry) u.speedNow *= 0.85
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
      if (s.kind === 'rocket' || s.kind === 'mlrs') {
        s.trailT -= dt
        if (s.trailT <= 0) {
          s.trailT = 0.04
          const p = this.shotPos(s)
          this.addFx('smoke', p.x, p.y, p.z, 0, 0, 3, 0.7, 1)
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

  private impact(s: Shot) {
    const big = s.kind === 'art' || s.kind === 'mlrs'
    if (s.splash > 0) {
      for (const e of this.ents) {
        if (e.dead || e.air) continue
        const d = e.isB ? this.distPt(e, s.x1, s.y1) : Math.hypot(e.x - s.x1, e.y - s.y1)
        if (d > s.splash) continue
        this.damage(e, s.dmg * (1 - (d / s.splash) * 0.6), s.cls, s.owner)
      }
      this.addFx('exp', s.x1, s.y1, 2, 0, 0, 0, 0.6, big ? 1 : 0)
      if (big) {
        this.stamps.push({ kind: 'scorch', size: 0, x: s.x1, y: s.y1 })
        for (let k = 0; k < 4; k++) this.addFx('debris', s.x1, s.y1, 2, (this.rand() - 0.5) * 2, (this.rand() - 0.5) * 2, 20 + this.rand() * 20, 0.8, 1)
      }
      this.onSound('boom', s.x1, s.y1)
      return
    }
    const t = s.target
    if (t && !t.dead) {
      this.damage(t, s.dmg, s.cls, s.owner)
      if (s.kind === 'shell' || s.kind === 'rocket') {
        this.addFx('exp', s.x1, s.y1, s.z1, 0, 0, 0, 0.4, 0)
        this.onSound('hit', s.x1, s.y1)
      } else this.addFx('spark', s.x1, s.y1, s.z1, 0, 0, 6, 0.25, 1)
    } else {
      this.addFx(s.kind === 'shell' || s.kind === 'rocket' ? 'exp' : 'dust', s.x1, s.y1, 1, 0, 0, 3, 0.4, s.kind === 'shell' || s.kind === 'rocket' ? 0 : 2)
    }
  }

  private distPt(b: Ent, x: number, y: number): number {
    const dx = Math.max(b.tx - x, 0, x - (b.tx + b.w))
    const dy = Math.max(b.ty - y, 0, y - (b.ty + b.h))
    return Math.hypot(dx, dy)
  }

  damage(e: Ent, dmg: number, cls: WClass, from: number) {
    if (e.dead || e.owner === from) return
    const armor = e.isB ? 'bld' : e.u!.armor
    const d = dmg * VS[cls][armor] * (0.9 + this.rand() * 0.2)
    e.hp -= d
    e.lastHit = this.time
    // under fire: those near it come to help
    if (e.owner === 0 && this.time - this.alertT > 20) {
      this.alertT = this.time
      this.msg(e.isB ? 'Unsere Basis wird angegriffen!' : 'Unsere Einheiten werden angegriffen!', 'warn')
      this.onSound('alert', e.x, e.y)
    }
    const attacker = this.nearestEnemyShooter(e, from)
    if (attacker) e.lastAttacker = attacker
    if (!e.isB && e.order === 'idle' && !e.target && attacker && e.weapon && this.canHit(e, attacker)) e.target = attacker
    if (e.hp <= 0) this.kill(e, from)
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

  kill(e: Ent, by: number) {
    if (e.dead) return
    this.players[e.owner].stats.lost++
    if (by >= 0) this.players[by].stats.killed++
    if (e.isB) {
      this.removeBuilding(e, true)
      return
    }
    e.dead = true
    e.selected = false
    this.byId.delete(e.id)
    if (e.u!.infantry) {
      this.addFx('dust', e.x, e.y, 2, 0, 0, 2, 0.6, 2)
      this.onSound('scream', e.x, e.y)
      return
    }
    this.addFx('exp', e.x, e.y, e.air ? e.z : 4, 0, 0, 0, 0.75, 1)
    for (let k = 0; k < 6; k++) this.addFx('debris', e.x, e.y, e.z + 4, (this.rand() - 0.5) * 3, (this.rand() - 0.5) * 3, 25 + this.rand() * 25, 1, 1)
    this.stamps.push({ kind: 'scorch', size: 1, x: e.x, y: e.y })
    this.wrecks.push({ key: e.key, owner: e.owner, x: e.x, y: e.y, dir: e.dir, tdir: e.tdir, t: 0, air: e.air })
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
      if (e.owner !== 0 || e.dead) continue
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
