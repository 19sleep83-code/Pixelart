// The computer opponent. It builds its base to a plan, keeps its trucks running, trains a mixed
// army without pause, defends what is attacked, and sends ever larger waves at the player.

import type { Game, Ent } from './game'
import { Ter } from './map'

const PLAN = ['power', 'ref', 'barracks', 'power', 'factory', 'bunker', 'ref', 'radar', 'power', 'rocket', 'helipad', 'power', 'bunker', 'rocket', 'factory', 'power', 'rocket', 'bunker']

export class AI {
  p = 1
  private thinkT = 2
  private planIdx = 0
  private waveSize: number
  private nextAttack: number
  private attackers = new Set<number>()
  private extraT = 0
  private r: () => number

  constructor(public g: Game) {
    const d = g.opts.difficulty
    this.waveSize = [5, 7, 8][d]
    this.nextAttack = [420, 300, 210][d]
    this.r = g.rand
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
      else g.cancelItem(this.p, 'build', q[0].key)
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
    const next = this.planIdx < PLAN.length ? g.bdefs[PLAN[this.planIdx]].power : -20
    if (use - Math.min(0, next) + 10 > prod) {
      g.queueItem(this.p, 'build', 'power')
      return
    }
    if (this.planIdx < PLAN.length) {
      const key = PLAN[this.planIdx]
      if (g.missing(this.p, g.bdefs[key].req).length) return
      if (g.queueItem(this.p, 'build', key)) this.planIdx++
      return
    }
    // after the plan: more defences now and then while money allows
    this.extraT++
    if (pl.credits > 2500 && this.extraT % 8 === 0) {
      const defs = this.mine().filter((e) => e.b?.defense).length
      if (defs < 10) g.queueItem(this.p, 'build', this.r() < 0.5 ? 'rocket' : 'bunker')
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
    if (g.hasBuilding(this.p, 'barracks') && pl.queues.inf.length < 2 && (wealthy || pl.queues.inf.length === 0)) {
      g.queueItem(this.p, 'inf', this.r() < 0.55 ? 'rifle' : 'at')
    }
    if (g.hasBuilding(this.p, 'factory') && pl.queues.veh.length < 2 && pl.credits > 400) {
      const radar = g.hasBuilding(this.p, 'radar')
      const enemyAir = g.ents.some((e) => e.owner !== this.p && e.air && !e.dead)
      const roll = this.r()
      let key = roll < 0.42 ? 'mbt' : roll < 0.72 ? 'ifv' : roll < 0.86 ? 'art' : 'aa'
      if (!radar && (key === 'art' || key === 'aa')) key = 'mbt'
      if (enemyAir && radar && this.mine('aa').length < 3) key = 'aa'
      g.queueItem(this.p, 'veh', key)
    }
    if (g.hasBuilding(this.p, 'helipad') && pl.queues.air.length < 1 && pl.credits > 1500 && this.mine('heli').length < 4) {
      g.queueItem(this.p, 'air', 'heli')
    }
  }

  private army() {
    const g = this.g
    const units = this.mine().filter((e) => !e.isB && e.weapon)
    // defend: whatever hit us recently gets a visit
    const hurt = this.mine().find((e) => e.isB && g.time - e.lastHit < 6 && e.lastAttacker && !e.lastAttacker.dead)
    if (hurt) {
      const foe = hurt.lastAttacker!
      const home = units.filter((u) => !this.attackers.has(u.id) && Math.hypot(u.x - hurt.x, u.y - hurt.y) < 22)
      for (const u of home) if (u.order === 'idle' || (u.order === 'amove' && !u.target)) g.commandMove([u], foe.x, foe.y, true)
    }
    // attack waves
    for (const id of this.attackers) if (!g.byId.has(id)) this.attackers.delete(id)
    const idle = units.filter((u) => !this.attackers.has(u.id) && (u.order === 'idle' || (u.order === 'amove' && !u.dest && !u.path.length)))
    if (g.time > this.nextAttack && (idle.length >= this.waveSize || (g.time > this.nextAttack + 120 && idle.length >= 5))) {
      const target = this.targetBuilding()
      if (target) {
        g.commandMove(idle, target.x, target.y, true)
        for (const u of idle) this.attackers.add(u.id)
        this.waveSize = Math.min(24, this.waveSize + 2)
        this.nextAttack = g.time + [150, 110, 80][g.opts.difficulty]
        g.msg('Feindliche Truppen rücken vor!', 'warn')
      }
    }
    // attackers that have arrived look for the next target
    for (const id of this.attackers) {
      const u = g.byId.get(id)
      if (!u) continue
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

  private targetBuilding(from?: Ent): Ent | null {
    const g = this.g
    const hq = from ?? this.mine('hq')[0] ?? this.mine()[0]
    if (!hq) return null
    let best: Ent | null = null
    let bd = 1e9
    for (const e of g.ents) {
      if (e.dead || e.owner === this.p) continue
      if (!e.isB && from) continue
      const d = Math.hypot(e.x - hq.x, e.y - hq.y)
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
    const enemy = g.ents.find((e) => e.owner !== this.p && e.key === 'hq')
    const ex = enemy?.x ?? m.N / 2, ey = enemy?.y ?? m.N / 2
    let best: { x: number; y: number } | null = null
    let bs = 1e9
    for (let r = 2; r <= 16; r++) {
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
      if (best && r > 6) break
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
