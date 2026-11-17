// Every sprite the game draws, rendered once from the voxel models while the loading bar runs.

import { Rot, renderSprite, renderShadow, makeCanvas, toSprite, type Sprite, type Vox } from '../core/voxel'
import { toABGR, mix, shade, KZ } from '../core/iso'
import { hash2 } from '../core/rng'
import { unitModel, buildingModel, treeModel, houseModel, oreModel } from './models'
import type { Faction } from './colors'
import { UNIT_ORDER, BUILD_ORDER } from './defs'
import type { StaticKind } from './map'

export interface UnitArt {
  hull: Rot
  turret?: Rot
  /** infantry: the two steps of a walk; harvester: loaded */
  alt?: Rot
  alt2?: Rot
  wreck?: Rot
  wreckTurret?: Rot
  mount: [number, number, number]
  muzzle: [number, number]
  rotor?: { r: number; z: number; tail: number }
  icon: HTMLCanvasElement
}

export interface BuildingArt {
  body: Sprite
  shadow: Sprite
  turret?: Rot
  mount: [number, number, number]
  icon: HTMLCanvasElement
}

export interface StaticArt {
  sp: Sprite
  sh: Sprite
}

export class Assets {
  units = {} as Record<Faction, Record<string, UnitArt>>
  buildings = {} as Record<Faction, Record<string, BuildingArt>>
  statics = {} as Record<StaticKind, StaticArt[]>
  ore: Sprite[][] = []
  explosions: Sprite[][] = []
  smoke: Sprite[] = []
  fire: Sprite[] = []
  rubble: Sprite[] = []
  scorch: Sprite[] = []
}

const frame = () => new Promise<void>((r) => requestAnimationFrame(() => r()))

function iconOf(sp: Sprite, extra?: { sp: Sprite; dx: number; dy: number }): HTMLCanvasElement {
  // crop to what is drawn, so the icon fills its button
  const W = sp.w, H = sp.h
  const cv = makeCanvas(W, H)
  const c = cv.getContext('2d')!
  c.drawImage(sp.cv, 0, 0)
  if (extra) c.drawImage(extra.sp.cv, sp.ax + extra.dx - extra.sp.ax, sp.ay + extra.dy - extra.sp.ay)
  const d = c.getImageData(0, 0, W, H).data
  let x0 = W, y0 = H, x1 = 0, y1 = 0
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3]) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
  const out = makeCanvas(x1 - x0 + 3, y1 - y0 + 3)
  out.getContext('2d')!.drawImage(cv, x0, y0, x1 - x0 + 1, y1 - y0 + 1, 1, 1, x1 - x0 + 1, y1 - y0 + 1)
  return out
}

/** where a turret pivot lands on screen, relative to the hull pivot, at a heading */
export function mountOffset(mount: [number, number, number], yaw: number): [number, number] {
  const [a, b, c] = mount
  const rx = -a * Math.sin(yaw) + b * Math.cos(yaw)
  const ry = a * Math.cos(yaw) + b * Math.sin(yaw)
  return [rx - ry, (rx + ry) * 0.5 - c * KZ]
}

function fx(): Pick<Assets, 'explosions' | 'smoke' | 'fire' | 'scorch' | 'rubble'> {
  const FIRE = [0xfffbe0, 0xffe07a, 0xffb13a, 0xf07a26, 0xc4461c, 0x7a2c18].map((c) => c)
  const explosions: Sprite[][] = []
  for (const R of [5, 9, 15]) {
    const frames: Sprite[] = []
    const F = 12
    for (let f = 0; f < F; f++) {
      const t = f / (F - 1)
      const S = R * 2 + 6
      const px = new Uint32Array(S * S)
      const rad = R * (0.45 + 0.65 * Math.sqrt(t))
      for (let y = 0; y < S; y++)
        for (let x = 0; x < S; x++) {
          const dx = x - S / 2 + 0.5, dy = (y - S / 2 + 0.5) * 1.25
          const d = Math.hypot(dx, dy) / rad
          const n = hash2(x >> 1, y >> 1, R * 31 + (f >> 2)) * 0.5 + hash2(x, y, f) * 0.25
          if (d > 1 + n * 0.25) continue
          const heat = 1.25 - t * 1.35 - d * 0.55 + n * 0.35
          if (t > 0.55 && heat < 0.15) {
            // smoke at the end
            if (hash2(x, y, f + 7) < 0.5 + (1 - t)) px[y * S + x] = toABGR(mix(0x4a4744, 0x26221f, d), Math.round(220 * (1 - t) + 60))
            continue
          }
          const k = Math.max(0, Math.min(FIRE.length - 1, Math.floor((1 - Math.max(0, Math.min(1, heat))) * FIRE.length)))
          px[y * S + x] = toABGR(FIRE[k])
        }
      frames.push(toSprite(px, S, S, S >> 1, S >> 1))
    }
    explosions.push(frames)
  }
  // dithered smoke puffs, light on top
  const smoke: Sprite[] = []
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  for (let r = 1; r <= 9; r++) {
    const S = r * 2 + 3
    const px = new Uint32Array(S * S)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const dx = x - S / 2 + 0.5, dy = y - S / 2 + 0.5
        const d = Math.hypot(dx, dy) / (r + 0.3)
        if (d > 1) continue
        const lit = dy < -r * 0.3 || dx < -r * 0.4
        const c = lit ? 0xc8c6c0 : d > 0.75 ? 0x8a8782 : 0xa9a6a0
        if (d > 0.8 && BAYER[(y & 3) * 4 + (x & 3)] < 8) continue
        px[y * S + x] = toABGR(c)
      }
    smoke.push(toSprite(px, S, S, S >> 1, S >> 1))
  }
  // small flames for burning wrecks and buildings
  const fire: Sprite[] = []
  for (let f = 0; f < 6; f++) {
    const W = 7, H = 11
    const px = new Uint32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (x - 3) / 3.2
        const v = 1 - y / H
        const w = (1 - v) * 1.1 + 0.15
        const n = hash2(x, y + f * 3, 91)
        if (Math.abs(dx) > w - n * 0.3) continue
        const heat = 1 - v - Math.abs(dx) * 0.4 + n * 0.2
        px[y * W + x] = toABGR(heat > 0.85 ? 0xfff0b0 : heat > 0.6 ? 0xffc040 : heat > 0.35 ? 0xf07a20 : 0xb83a18)
      }
    fire.push(toSprite(px, W, H, 3, H - 1))
  }
  // scorch marks and rubble for the ground
  const scorch: Sprite[] = []
  for (const R of [5, 9, 14]) {
    const W = R * 4 + 2, H = R * 2 + 2
    const px = new Uint32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - W / 2) / (R * 2), (y - H / 2) / R)
        const n = hash2(x, y, R)
        if (d + n * 0.3 > 1) continue
        px[y * W + x] = toABGR(d < 0.45 ? 0x1e1b17 : 0x2e2a22, Math.round(200 - d * 120))
      }
    scorch.push(toSprite(px, W, H, W >> 1, H >> 1))
  }
  const rubble: Sprite[] = []
  for (const T of [1, 2, 3]) {
    const W = T * 32 + 4, H = T * 16 + 4
    const px = new Uint32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x - W / 2) / (W / 2) + Math.abs(y - H / 2) / (H / 2)
        if (d > 0.98) continue
        const n = hash2(x >> 1, y, T * 3)
        const c = n < 0.35 ? 0x3a3631 : n < 0.6 ? 0x6e6a62 : n < 0.8 ? 0x8a867c : 0x4a443c
        px[y * W + x] = toABGR(c, d > 0.8 ? 170 : 235)
      }
    rubble.push(toSprite(px, W, H, W >> 1, H >> 1))
  }
  return { explosions, smoke, fire, scorch, rubble }
}

export async function buildAssets(onProgress: (t: number, what: string) => void): Promise<Assets> {
  const A = new Assets()
  Object.assign(A, fx())
  const jobs: [string, () => void][] = []
  for (const f of ['nato', 'ru'] as Faction[]) {
    A.units[f] = {}
    A.buildings[f] = {}
    for (const key of UNIT_ORDER) {
      jobs.push([`Einheiten: ${key}`, () => {
        const um = unitModel(key, f)
        const inf = key === 'rifle' || key === 'at'
        const dirs = inf ? 16 : 32
        const hull = new Rot(um.hull, dirs)
        const art: UnitArt = {
          hull,
          mount: um.mount ?? [0, 0, 0],
          muzzle: um.muzzle ?? [6, 3],
          rotor: um.rotor,
          icon: makeCanvas(1, 1),
        }
        if (inf) {
          art.alt = new Rot(um.alt!, dirs, {}, false)
          art.alt2 = new Rot(um.turret!, dirs, {}, false)
        } else {
          if (um.turret) art.turret = new Rot(um.turret, 32, {}, false)
          if (um.alt) art.alt = new Rot(um.alt, dirs, {}, false)
          if (key !== 'heli') {
            art.wreck = new Rot(um.hull, 16, { dark: 0.42 }, false)
            if (um.turret) art.wreckTurret = new Rot(um.turret, 16, { dark: 0.42 }, false)
          } else art.wreck = new Rot(um.hull, 16, { dark: 0.42 }, false)
        }
        const yaw = 2.2
        const sp = renderSprite(um.hull, yaw)
        if (um.turret && !inf && um.mount) {
          const [dx, dy] = mountOffset(um.mount, yaw)
          art.icon = iconOf(sp, { sp: renderSprite(um.turret, yaw), dx, dy })
        } else art.icon = iconOf(sp)
        A.units[f][key] = art
      }])
    }
    for (const key of ['hq', ...BUILD_ORDER]) {
      jobs.push([`Gebäude: ${key}`, () => {
        const bm = buildingModel(key, f)
        const body = renderSprite(bm.body, 0)
        const ba: BuildingArt = { body, shadow: renderShadow(bm.body, 0, 0.3), mount: bm.mount ?? [0, 0, 0], icon: makeCanvas(1, 1) }
        if (bm.turret) ba.turret = new Rot(bm.turret, 32, {}, false)
        ba.icon = bm.turret
          ? iconOf(body, { sp: renderSprite(bm.turret, 2.2), dx: 0, dy: -bm.mount![2] * KZ })
          : iconOf(body)
        A.buildings[f][key] = ba
      }])
    }
  }
  jobs.push(['Landschaft', () => {
    const mk = (m: Vox): StaticArt => ({ sp: renderSprite(m, 0), sh: renderShadow(m, 0, 0.3) })
    A.statics = {
      oak: [0, 1, 2, 3].map((i) => mk(treeModel('oak', i))),
      pine: [0, 1, 2, 3].map((i) => mk(treeModel('pine', i))),
      birch: [0, 1].map((i) => mk(treeModel('birch', i))),
      house: [0, 1, 2, 3].map((i) => mk(houseModel('house', i))),
      timber: [0, 1, 2].map((i) => mk(houseModel('timber', i))),
      church: [mk(houseModel('church', 0))],
      barn: [0, 1].map((i) => mk(houseModel('barn', i))),
    }
    A.ore = [0, 1, 2].map((st) => [0, 1, 2].map((v) => renderSprite(oreModel(st, v + 1), 0)))
  }])
  for (let i = 0; i < jobs.length; i++) {
    onProgress(i / jobs.length, jobs[i][0])
    await frame()
    jobs[i][1]()
  }
  onProgress(1, 'fertig')
  void shade
  return A
}
