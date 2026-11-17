// The computer opponent. It builds its base to a plan, keeps its trucks running, trains a mixed
// army without pause, defends what is attacked, and sends ever larger waves at the player.

import type { Game, Ent } from './game'
import { Ter } from './map'

const LAND_PLAN = ['power', 'ref', 'barracks', 'power', 'factory', 'bunker', 'ref', 'radar', 'power', 'rocket', 'helipad', 'power', 'airfield', 'bunker', 'rocket', 'factory', 'power', 'rocket', 'bunker']
const SEA_PLAN = ['power', 'ref', 'barracks', 'power', 'factory', 'bunker', 'ref', 'radar', 'power', 'shipyard', 'rocket', 'helipad', 'power', 'airfield', 'bunker', 'power', 'rocket', 'factory', 'rocket', 'bunker']

export class AI {
  p = 1
  private thinkT = 2
  private planIdx = 0
  private waveSize: number
  private nextAttack: number
  private attackers = new Set<number>()
  private extraT = 0
  private r: () => number
  private plan: string[]
  private noShipyard = false
  private fleet = new Set<number>()
  private nextFleet: number
  private strikeT = 0
  private holdT = 20
  /** the wave on its way: it gathers short of the target first, then goes in together */
  private wave: { ids: number[]; stage: { x: number; y: number }; target: Ent; t0: number; phase: 'gather' | 'go' } | null = null
  private waves = 0
  private engT = 200

  constructor(public g: Game) {
    const d = g.opts.difficulty
    this.waveSize = [5, 7, 8][d]
    this.nextAttack = [420, 300, 210][d]
    this.r = g.rand
    this.plan = g.map.type === 'land' ? LAND_PLAN : SEA_PLAN
    this.nextFleet = this.nextAttack + 60
  }

  update(dt: number) {
    this.thinkT -= dt
    if (this.thinkT > 0) return
    this.thinkT = [1.4, 0.9, 0.6][this.g.opts.difficulty]
    const pl = this.g.players[this.p]
    if (!pl.alive) return
    this.base()
    this.train()
    this.army()
    this.hold()
    this.engineers()
  }

  /** soldiers dig into the houses round the base */
  private hold() {
    const g = this.g
    this.holdT -= this.thinkT
    if (this.holdT > 0) return
    this.holdT = 8
    const hq = this.mine('hq')[0] ?? this.mine().find((e) => e.isB)
    if (!hq) return
    const want = [3, 6, 9][g.opts.difficulty]
    const inside = this.mine().filter((u) => u.inside || u.order === 'enter').length
    if (inside >= want) return
    const idle = this.mine().filter((u) => u.u?.infantry && !u.u.engineer && !u.inside && !this.attackers.has(u.id) && !u.target && (u.order === 'idle' || (u.order === 'amove' && !u.dest && !u.path.length)))
    if (idle.length < 3) return
    const free = g.garrisons
      .filter((h) => !h.b && g.canEnter(this.p, h) && Math.hypot(h.x - hq.x, h.y - hq.y) < 28)
      .sort((a, b) => Math.hypot(a.x - hq.x, a.y - hq.y) - Math.hypot(b.x - hq.x, b.y - hq.y))
    const h = free[0]
    if (!h) return
    const n = Math.min(h.cap - h.occ.length, want - inside, idle.length - 1)
    if (n <= 0) return
    idle.sort((a, b) => Math.hypot(a.x - h.x, a.y - h.y) - Math.hypot(b.x - h.x, b.y - h.y))
    g.commandGarrison(idle.slice(0, n), h)
  }

  /** now and then a sapper tries to take over an enemy building */
  private engineers() {
    const g = this.g
    const pl = g.players[this.p]
    if (g.opts.difficulty === 0) return
    this.engT -= this.thinkT
    if (this.engT <= 0 && g.hasBuilding(this.p, 'barracks') && pl.credits > 1200 && !this.mine('engineer').length) {
      this.engT = 140
      g.queueItem(this.p, 'inf', 'engineer')
    }
    for (const u of this.mine('engineer')) {
      if (u.order !== 'idle') continue
      let best: Ent | null = null
      let bd = 1e9
      for (const b of g.ents) {
        if (!b.isB || b.dead || b.owner === this.p || b.key === 'hq') continue
        const d = Math.hypot(b.x - u.x, b.y - u.y) + (b.b!.defense ? 12 : 0)
        if (d < bd) {
          bd = d
          best = b
        }
      }
      if (best) g.commandCapture([u], best)
    }
  }

  private mine(key?: string): Ent[] {
    return this.g.ents.filter((e) => !e.dead && e.owner === this.p && (key === undefined || e.key === key))
  }

  private base() {
    const g = this.g
    const pl = g.players[this.p]
    const q = pl.queues.build
    if (q[0]?.ready) {
      const spot = this.findSpot(q[0].key)
      if (spot) g.placeReady(this.p, spot.x, spot.y)
      else {
        if (q[0].key === 'shipyard') this.noShipyard = true
        g.cancelItem(this.p, 'build', q[0].key)
      }
      return
    }
    if (q.length || !this.mine('hq').length) return
    if (this.mine('ref').length && !this.mine('harv').length && g.hasBuilding(this.p, 'factory')) return
    // keep the lights on first, counting what is still going up
    let prod = 0, use = 0
    for (const e of this.mine()) {
      if (!e.isB) continue
      if (e.b!.power > 0) prod += e.b!.power
      else use -= e.b!.power
    }
    const next = this.planIdx < this.plan.length ? g.bdefs[this.plan[this.planIdx]].power : -20
    if (use - Math.min(0, next) + 10 > prod) {
      g.queueItem(this.p, 'build', 'power')
      return
    }
    if (this.planIdx < this.plan.length) {
      const key = this.plan[this.planIdx]
      if (key === 'shipyard' && this.noShipyard) {
        this.planIdx++
        return
      }
      if (g.missing(this.p, g.bdefs[key].req).length) return
      if (g.queueItem(this.p, 'build', key)) this.planIdx++
      return
    }
    // after the plan: more defences now and then while money allows
    this.extraT++
    if (pl.credits > 2500 && this.extraT % 8 === 0) {
      const defs = this.mine().filter((e) => e.b?.defense).length
      if (defs < 6) g.queueItem(this.p, 'build', this.r() < 0.5 ? 'rocket' : 'bunker')
    }
  }

  private train() {
    const g = this.g
    const pl = g.players[this.p]
    const refs = this.mine('ref').length
    const harv = this.mine('harv').length
    const harvQueued = pl.queues.veh.filter((i) => i.key === 'harv').length
    // no trucks left: everything else waits, the money goes into a new one
    if (refs && harv === 0 && g.hasBuilding(this.p, 'factory')) {
      for (const q of ['inf', 'veh', 'air'] as const)
        for (const it of [...pl.queues[q]]) if (it.key !== 'harv') g.cancelItem(this.p, q, it.key)
      if (!harvQueued) g.queueItem(this.p, 'veh', 'harv')
      return
    }
    if (refs && harv + harvQueued < Math.min(refs * 2, 5) && g.hasBuilding(this.p, 'factory') && pl.queues.veh.length < 3) {
      g.queueItem(this.p, 'veh', 'harv')
    }
    const wealthy = pl.credits > 600
    // short of money: no more than two things at once, so something actually gets finished
    const busy = (['inf', 'veh', 'air', 'sea'] as const).filter((q) => pl.queues[q].length > 0).length
    const room = (q: 'inf' | 'veh' | 'air' | 'sea') => pl.queues[q].length > 0 || wealthy || busy < 2
    if (g.hasBuilding(this.p, 'barracks') && pl.queues.inf.length < (wealthy ? 2 : 1) && room('inf') && (busy === 0 || this.r() < 0.5)) {
      g.queueItem(this.p, 'inf', this.r() < 0.55 ? 'rifle' : 'at')
    }
    if (g.hasBuilding(this.p, 'factory') && pl.queues.veh.length < (wealthy ? 2 : 1) && room('veh')) {
      const radar = g.hasBuilding(this.p, 'radar')
      const enemyAir = g.ents.some((e) => e.owner !== this.p && e.air && !e.dead)
      const roll = this.r()
      let key = roll < 0.4 ? 'mbt' : roll < 0.66 ? 'ifv' : roll < 0.76 ? 'art' : roll < 0.86 ? 'mlrs' : 'aa'
      if (!radar && (key === 'art' || key === 'mlrs' || key === 'aa')) key = 'mbt'
      if (enemyAir && radar && this.mine('aa').length < 3) key = 'aa'
      g.queueItem(this.p, 'veh', key)
    }
    if (pl.queues.air.length < 1 && room('air')) {
      const slots = this.mine('airfield').filter((b) => b.built >= 1).length * 3
      const jets = this.mine('jet').filter((j) => j.home && g.byId.get(j.home)?.isB).length
      if (slots > jets && (this.r() < 0.5 || !g.hasBuilding(this.p, 'helipad'))) g.queueItem(this.p, 'air', 'jet')
      else if (g.hasBuilding(this.p, 'helipad') && this.mine('heli').length < 4) g.queueItem(this.p, 'air', 'heli')
    }
    // the navy
    if (g.hasBuilding(this.p, 'shipyard') && pl.queues.sea.length < 1 && room('sea')) {
      const roll = this.r()
      let key = roll < 0.3 ? 'boat' : roll < 0.65 ? 'corvette' : 'destroyer'
      if (key === 'destroyer' && !g.hasBuilding(this.p, 'radar')) key = 'corvette'
      if (g.hasBuilding(this.p, 'airfield') && !this.mine('carrier').length && roll > 0.85) key = 'carrier'
      g.queueItem(this.p, 'sea', key)
    }
  }

  private army() {
    const g = this.g
    this.navy()
    this.jets()
    const units = this.mine().filter((e) => !e.isB && e.weapon && !e.naval && !e.jet && !e.inside && e.order !== 'enter')
    // defend: whatever hit us recently gets a visit
    const hurt = this.mine().find((e) => e.isB && g.time - e.lastHit < 6 && e.lastAttacker && !e.lastAttacker.dead)
    if (hurt) {
      const foe = hurt.lastAttacker!
      const home = units.filter((u) => !this.attackers.has(u.id) && Math.hypot(u.x - hurt.x, u.y - hurt.y) < 22)
      for (const u of home) if (u.order === 'idle' || (u.order === 'amove' && !u.target)) g.commandMove([u], foe.x, foe.y, true)
    }
    // attack waves: they gather short of the enemy base, then go in together
    for (const id of this.attackers) if (!g.byId.has(id)) this.attackers.delete(id)
    const idle = units.filter((u) => !this.attackers.has(u.id) && (u.order === 'idle' || (u.order === 'amove' && !u.dest && !u.path.length)))
    // late in the game: everything but a few guards goes
    const allIn = g.time > 18 * 60
    const keep = allIn ? 3 : 0
    const ready = idle.length - keep >= this.waveSize || (g.time > this.nextAttack + 90 && idle.length - keep >= 5)
    if (!this.wave && g.time > this.nextAttack && ready) {
      const target = this.siegeTarget()
      const hq = this.mine('hq')[0] ?? this.mine().find((e) => e.isB)
      if (target && hq) {
        const go = idle.sort((a, b) => Math.hypot(a.x - target.x, a.y - target.y) - Math.hypot(b.x - target.x, b.y - target.y)).slice(0, idle.length - keep)
        const d = Math.hypot(hq.x - target.x, hq.y - target.y) || 1
        const k = Math.min(12, d * 0.45)
        const sp = g.pf.nearestWalkable(target.x + ((hq.x - target.x) / d) * k, target.y + ((hq.y - target.y) / d) * k)
        const stage = sp ? { x: sp.x + 0.5, y: sp.y + 0.5 } : { x: target.x, y: target.y }
        g.commandMove(go, stage.x, stage.y, true)
        for (const u of go) this.attackers.add(u.id)
        this.wave = { ids: go.map((u) => u.id), stage, target, t0: g.time, phase: 'gather' }
        this.waves++
        this.waveSize = Math.min(14, this.waveSize + 2)
        this.nextAttack = g.time + Math.max(45, [150, 110, 80][g.opts.difficulty] - this.waves * 8)
        g.msg('Feindliche Truppen rücken vor!', 'warn')
      }
    }
    if (this.wave) {
      const w = this.wave
      const live = w.ids.map((id) => g.byId.get(id)).filter((u): u is Ent => !!u && !u.dead)
      if (!live.length) this.wave = null
      else if (w.phase === 'gather') {
        const near = live.filter((u) => Math.hypot(u.x - w.stage.x, u.y - w.stage.y) < 5).length
        if (near >= live.length * 0.7 || g.time - w.t0 > 45) {
          const t = w.target.dead ? this.siegeTarget() : w.target
          if (t) g.commandMove(live, t.x, t.y, true)
          w.phase = 'go'
          if (!t) this.wave = null
        }
      } else this.wave = null
    }
    // attackers that have arrived look for the next target
    for (const id of this.attackers) {
      const u = g.byId.get(id)
      if (!u) continue
      if (this.wave?.phase === 'gather' && this.wave.ids.includes(id)) continue
      if (u.order === 'idle' || (u.order === 'amove' && !u.target && !u.path.length && !u.dest)) {
        const t = this.targetBuilding(u)
        if (t) g.commandMove([u], t.x, t.y, true)
      }
    }
    // idle units gather in front of the base
    const hq = this.mine('hq')[0] ?? this.mine().find((e) => e.isB)
    if (hq) {
      const enemy = g.ents.find((e) => e.owner !== this.p && e.key === 'hq') ?? g.ents.find((e) => e.owner !== this.p && e.isB)
      const ex = enemy ? enemy.x : g.map.N / 2, ey = enemy ? enemy.y : g.map.N / 2
      const d = Math.hypot(ex - hq.x, ey - hq.y) || 1
      const rx = hq.x + ((ex - hq.x) / d) * 9, ry = hq.y + ((ey - hq.y) / d) * 9
      const loose = idle.filter((u) => Math.hypot(u.x - rx, u.y - ry) > 5 && !u.target && Math.hypot(u.x - hq.x, u.y - hq.y) < 14)
      if (loose.length) g.commandMove(loose, rx, ry, true)
    }
  }

  /** ships sail in groups for the enemy buildings nearest the water */
  private navy() {
    const g = this.g
    for (const id of this.fleet) if (!g.byId.has(id)) this.fleet.delete(id)
    const ships = this.mine().filter((e) => e.naval && e.weapon)
    const idle = ships.filter((u) => !this.fleet.has(u.id) && (u.order === 'idle' || (u.order === 'amove' && !u.dest && !u.path.length)))
    const carrierIdle = this.mine('carrier').filter((c) => c.order === 'idle' && !c.dest)
    if (g.time > this.nextFleet && idle.length >= 3) {
      const t = this.shoreTarget()
      if (t) {
        g.commandMove([...idle, ...carrierIdle], t.x, t.y, true)
        for (const u of idle) this.fleet.add(u.id)
        this.nextFleet = g.time + 90
      }
    }
    for (const id of this.fleet) {
      const u = g.byId.get(id)
      if (!u) continue
      if (u.order === 'idle' || (u.order === 'amove' && !u.target && !u.path.length && !u.dest)) {
        const t = this.shoreTarget(u)
        if (t) g.commandMove([u], t.x, t.y, true)
      }
    }
  }

  /** the water next to the enemy building closest to it */
  private shoreTarget(from?: Ent): { x: number; y: number } | null {
    const g = this.g
    let best: { x: number; y: number } | null = null
    let bd = 1e9
    for (const e of g.ents) {
      if (e.dead || e.owner === this.p || !e.isB) continue
      const w = g.npf.nearestWalkable(e.x, e.y, 9)
      if (!w) continue
      const d = Math.hypot(w.x - e.x, w.y - e.y) * 4 + (from ? Math.hypot(e.x - from.x, e.y - from.y) * 0.3 : 0)
      if (d < bd) {
        bd = d
        best = { x: w.x + 0.5, y: w.y + 0.5 }
      }
    }
    return best
  }

  /** jets on the ground with weapons aboard fly at whatever matters most */
  private jets() {
    const g = this.g
    if (g.time < this.strikeT) return
    const ready = this.mine('jet').filter((j) => j.js === 'park' && j.ammo >= 1)
    if (!ready.length) return
    this.strikeT = g.time + 12
    // first whatever is hitting the base, else a building
    const hurt = this.mine().find((e) => e.isB && g.time - e.lastHit < 8 && e.lastAttacker && !e.lastAttacker.dead)
    let t: Ent | null = hurt?.lastAttacker ?? null
    if (!t) {
      const blds = g.ents.filter((e) => !e.dead && e.owner !== this.p && e.isB)
      blds.sort((a, b) => (b.b!.weapon ? 1 : 0) - (a.b!.weapon ? 1 : 0) || (a.key === 'power' ? -1 : 0))
      t = blds[Math.floor(this.r() * Math.min(4, blds.length))] ?? null
    }
    if (t) g.commandStrike(ready, t, t.x, t.y)
  }

  /** where a wave goes: the enemy's production and command first, the nearest of them to our base */
  private siegeTarget(): Ent | null {
    const g = this.g
    const hq = this.mine('hq')[0] ?? this.mine().find((e) => e.isB)
    if (!hq) return null
    const PRIO: Record<string, number> = { factory: 14, barracks: 10, hq: 12, airfield: 8, helipad: 8, shipyard: 6, ref: 9, power: 7, radar: 5 }
    let best: Ent | null = null
    let bs = 1e9
    for (const e of g.ents) {
      if (e.dead || e.owner === this.p || !e.isB) continue
      const sc = Math.hypot(e.x - hq.x, e.y - hq.y) - (PRIO[e.key] ?? 0)
      if (sc < bs) {
        bs = sc
        best = e
      }
    }
    return best ?? this.targetBuilding()
  }

  private targetBuilding(from?: Ent): Ent | null {
    const g = this.g
    const hq = from ?? this.mine('hq')[0] ?? this.mine()[0]
    if (!hq) return null
    let best: Ent | null = null
    let bd = 1e9
    for (const e of g.ents) {
      if (e.dead || e.owner === this.p) continue
      if (!e.isB && from) continue
      const d = Math.hypot(e.x - hq.x, e.y - hq.y) - (from && e.isB && (e.b!.produces || e.key === 'hq') ? 3 : 0)
      if (d < bd) {
        bd = d
        best = e
      }
    }
    if (!best && from) {
      for (const e of g.ents) {
        if (e.dead || e.owner === this.p) continue
        const d = Math.hypot(e.x - hq.x, e.y - hq.y)
        if (d < bd) {
          bd = d
          best = e
        }
      }
    }
    return best
  }

  /** a free spot near the base, with a gap round it so the roads stay open */
  private findSpot(key: string): { x: number; y: number } | null {
    const g = this.g
    const m = g.map
    const def = g.bdefs[key]
    const hq = this.mine('hq')[0] ?? this.mine().find((e) => e.isB)
    if (!hq) return null
    const far = def.shore ? 22 : 16
    const enemy = g.ents.find((e) => e.owner !== this.p && e.key === 'hq')
    const ex = enemy?.x ?? m.N / 2, ey = enemy?.y ?? m.N / 2
    let best: { x: number; y: number } | null = null
    let bs = 1e9
    for (let r = 2; r <= far; r++) {
      for (let dy = -r; dy <= r; dy++)
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue
          const tx = Math.floor(hq.x) + dx - Math.floor(def.w / 2)
          const ty = Math.floor(hq.y) + dy - Math.floor(def.h / 2)
          if (!g.canPlace(this.p, key, tx, ty)) continue
          if (!this.gapFree(tx, ty, def.w, def.h)) continue
          const cx = tx + def.w / 2, cy = ty + def.h / 2
          let s = r + this.r() * 2
          if (key === 'ref') s = this.oreDist(cx, cy) * 2 + r * 0.3
          if (def.defense) s = Math.hypot(cx - (hq.x + (ex - hq.x) * 0.12), cy - (hq.y + (ey - hq.y) * 0.12)) + this.r() * 3
          if (s < bs) {
            bs = s
            best = { x: tx, y: ty }
          }
        }
      if (best && r > 6 && !def.shore) break
    }
    return best
  }

  private gapFree(tx: number, ty: number, w: number, h: number): boolean {
    const m = this.g.map
    for (let y = ty - 1; y <= ty + h; y++)
      for (let x = tx - 1; x <= tx + w; x++) {
        if (!m.inMap(x, y)) return false
        const i = m.idx(x, y)
        if (m.bld[i]) return false
        if (m.ter[i] === Ter.Ore && (x === tx - 1 || y === ty - 1 || x === tx + w || y === ty + h)) continue
      }
    return true
  }

  private oreDist(x: number, y: number): number {
    const m = this.g.map
    let bd = 99
    for (let dy = -14; dy <= 14; dy++)
      for (let dx = -14; dx <= 14; dx++) {
        const tx = Math.floor(x) + dx, ty = Math.floor(y) + dy
        if (!m.inMap(tx, ty)) continue
        if (m.ore[m.idx(tx, ty)] > 0) bd = Math.min(bd, Math.hypot(dx, dy))
      }
    return bd
  }
}
