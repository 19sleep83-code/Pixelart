// Every sprite the game draws, rendered once from the voxel models while the loading bar runs.

import { Rot, renderSprite, renderShadow, makeCanvas, toSprite, type Sprite, type Vox } from '../core/voxel'
import { toABGR, mix, shade, KZ, SCALE } from '../core/iso'
import { hash2, fbm } from '../core/rng'
import { unitModel, buildingModel, treeModel, houseModel, oreModel, titleModel } from './models'
import type { Faction } from './colors'
import { UNIT_ORDER, BUILD_ORDER } from './defs'
import type { StaticKind } from './map'

export interface UnitArt {
  hull: Rot
  turret?: Rot
  /** infantry: the two steps of a walk; harvester: loaded */
  alt?: Rot
  alt2?: Rot
  /** a soldier taking aim */
  aim?: Rot
  /** tracks one link on, alternating with the hull while driving */
  hull2?: Rot
  /** frames that turn all the time: a ship's radar, a flak tank's radar */
  hullAnim?: Rot[]
  turretAnim?: Rot[]
  wreck?: Rot
  wreckTurret?: Rot
  mount: [number, number, number]
  muzzle: [number, number]
  rotor?: { r: number; z: number; tail: number; blades?: number; tailSide?: number }
  burner?: { back: number; side: number; z: number }
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
  dust: Sprite[] = []
  soot: Sprite[] = []
  fire: Sprite[] = []
  rubble: Sprite[] = []
  scorch: Sprite[] = []
  /** soft round glows for lights and the bloom of fire, by radius */
  glow = new Map<string, HTMLCanvasElement>()
  title: Sprite | null = null
  /** a soft round light of a colour; cached */
  glowOf(r: number, color: string): HTMLCanvasElement {
    const key = r + color
    let c = this.glow.get(key)
    if (c) return c
    c = makeCanvas(r * 2, r * 2)
    const x = c.getContext('2d')!
    const g = x.createRadialGradient(r, r, 0, r, r, r)
    g.addColorStop(0, color)
    g.addColorStop(1, 'rgba(0,0,0,0)')
    x.fillStyle = g
    x.fillRect(0, 0, r * 2, r * 2)
    this.glow.set(key, c)
    return c
  }
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
  return [(rx - ry) * SCALE, (rx + ry) * 0.5 * SCALE - c * KZ]
}

function fx(): Pick<Assets, 'explosions' | 'smoke' | 'dust' | 'soot' | 'fire' | 'scorch' | 'rubble'> {
  const FIRE = [0xfffbe0, 0xffe07a, 0xffb13a, 0xf07a26, 0xc4461c, 0x7a2c18].map((c) => c)
  const explosions: Sprite[][] = []
  for (const R of [5, 9, 15, 24].map((r) => r * SCALE)) {
    const frames: Sprite[] = []
    const F = 14
    for (let f = 0; f < F; f++) {
      const t = f / (F - 1)
      const S = R * 2 + 8
      const H = Math.round(S * 1.25)
      const px = new Uint32Array(S * H)
      // a fireball that swells and rises, with a dark sooty rim, then turns to smoke
      const rad = R * (0.4 + 0.7 * Math.sqrt(t))
      const cy = H * 0.62 - t * R * 0.55
      for (let y = 0; y < H; y++)
        for (let x = 0; x < S; x++) {
          const dx = x - S / 2 + 0.5, dy = (y - cy) * 1.15
          const d = Math.hypot(dx, dy) / rad
          const lump = hash2(x >> 1, y >> 1, R * 31 + (f >> 2)) * 0.45 + hash2(x >> 2, y >> 2, R + f) * 0.35
          if (d > 0.95 + lump * 0.35) continue
          const heat = 1.35 - t * 1.45 - d * 0.62 + lump * 0.4
          if (heat < 0.12) {
            if (t > 0.25 && hash2(x, y, f + 7) < 0.4 + (1 - t)) px[y * S + x] = toABGR(mix(0x55504a, 0x221e1b, Math.min(1, d)), Math.round(230 * (1 - t * 0.7)))
            continue
          }
          if (d > 0.78 + lump * 0.3 && t > 0.15) {
            px[y * S + x] = toABGR(0x3a2a20)
            continue
          }
          const k = Math.max(0, Math.min(FIRE.length - 1, Math.floor((1 - Math.max(0, Math.min(1, heat))) * FIRE.length)))
          px[y * S + x] = toABGR(FIRE[k])
        }
      frames.push(toSprite(px, S, H, S >> 1, Math.round(H * 0.62)))
    }
    explosions.push(frames)
  }
  // billowing smoke puffs: a few round lumps together, lit from the upper left with dithered
  // shades and a frayed rim, so that stacks of them read as one soft column
  const smoke: Sprite[] = []
  const dust: Sprite[] = []
  const soot: Sprite[] = []
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]
  for (const [list, cols] of [[smoke, [0x8a8782, 0xa9a6a0, 0xc8c6c0, 0xdedcd6]], [dust, [0x8a7656, 0xa89470, 0xc8b48c, 0xdccaa4]], [soot, [0x2a2724, 0x3e3a36, 0x56514c, 0x726c66]]] as [Sprite[], number[]][])
  for (let i = 1; i <= (list === soot ? 14 : 9); i++) {
    const r = list === soot ? i * 3 * SCALE : i * SCALE
    const S = r * 2 + 3
    const px = new Uint32Array(S * S)
    const seed = r * 13 + (list === soot ? 7 : list === dust ? 3 : 1)
    // the lumps: a big one in the middle and a few around it, a little higher up
    const lumps: [number, number, number][] = [[0, 0.08, 0.78]]
    for (let k = 0; k < 4; k++) {
      const a = hash2(k, seed, 3) * Math.PI * 2
      lumps.push([Math.cos(a) * 0.38, Math.sin(a) * 0.3 - 0.12, 0.42 + hash2(k, seed, 5) * 0.16])
    }
    const curl = Math.max(2, r * 0.45)
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const nx = (x - S / 2 + 0.5) / r, ny = (y - S / 2 + 0.5) / r
        // how deep inside the nearest lump, 0 at its rim
        let inside = -1, lx = 0, ly = 0, lr = 1
        for (const [cx, cy, cr] of lumps) {
          const v = 1 - Math.hypot(nx - cx, ny - cy) / cr
          if (v > inside) {
            inside = v
            lx = (nx - cx) / cr
            ly = (ny - cy) / cr
            lr = cr
          }
        }
        const n = fbm(x, y, curl, seed, 2) - 0.5
        const edge = inside + n * 0.35
        if (edge <= 0) continue
        const b = BAYER[(y & 3) * 4 + (x & 3)] / 16
        // a frayed, thinning rim
        if (edge < 0.16 && b > edge / 0.16) continue
        // light from the upper left on a round lump, curls of shade inside
        const z = Math.sqrt(Math.max(0, 1 - lx * lx - ly * ly))
        const light = (-lx * 0.5 - ly * 0.7 + z * 0.6) * (0.7 + lr * 0.4) + n * 0.9 - (1 - inside) * 0.15
        const v = Math.max(0, Math.min(3, (light + 0.35) * 2.6 + (b - 0.5) * 0.9))
        px[y * S + x] = toABGR(cols[Math.floor(v)])
      }
    list.push(toSprite(px, S, S, S >> 1, S >> 1))
  }
  // small flames for burning wrecks and buildings
  const fire: Sprite[] = []
  for (let f = 0; f < 6; f++) {
    const W = 7 * SCALE, H = 11 * SCALE
    const px = new Uint32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = (x - W / 2 + 0.5) / (3.2 * SCALE)
        const v = 1 - y / H
        const w = (1 - v) * 1.1 + 0.15
        const n = hash2(x >> 1, (y >> 1) + f * 3, 91)
        if (Math.abs(dx) > w - n * 0.3) continue
        const heat = 1 - v - Math.abs(dx) * 0.4 + n * 0.2
        px[y * W + x] = toABGR(heat > 0.85 ? 0xfff0b0 : heat > 0.6 ? 0xffc040 : heat > 0.35 ? 0xf07a20 : 0xb83a18)
      }
    fire.push(toSprite(px, W, H, W >> 1, H - 1))
  }
  // scorch marks and rubble for the ground
  const scorch: Sprite[] = []
  for (const R of [5, 9, 14].map((r) => r * SCALE)) {
    const W = R * 4 + 2, H = R * 2 + 2
    const px = new Uint32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.hypot((x - W / 2) / (R * 2), (y - H / 2) / R)
        const n = hash2(x >> 1, y >> 1, R)
        if (d + n * 0.3 > 1) continue
        px[y * W + x] = toABGR(d < 0.45 ? 0x1e1b17 : 0x2e2a22, Math.round(200 - d * 120))
      }
    scorch.push(toSprite(px, W, H, W >> 1, H >> 1))
  }
  const rubble: Sprite[] = []
  for (const T of [1, 2, 3]) {
    const W = T * 32 * SCALE + 4, H = T * 16 * SCALE + 4
    const px = new Uint32Array(W * H)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const d = Math.abs(x - W / 2) / (W / 2) + Math.abs(y - H / 2) / (H / 2)
        if (d > 0.98) continue
        const n = hash2(x >> 2, y >> 1, T * 3)
        const c = n < 0.35 ? 0x3a3631 : n < 0.6 ? 0x6e6a62 : n < 0.8 ? 0x8a867c : 0x4a443c
        px[y * W + x] = toABGR(c, d > 0.8 ? 170 : 235)
      }
    rubble.push(toSprite(px, W, H, W >> 1, H >> 1))
  }
  return { explosions, smoke, dust, soot, fire, scorch, rubble }
}

export async function buildAssets(onProgress: (t: number, what: string) => void, extraUnits: string[] = []): Promise<Assets> {
  const A = new Assets()
  Object.assign(A, fx())
  const jobs: [string, () => void][] = []
  for (const f of ['nato', 'ru'] as Faction[]) {
    A.units[f] = {}
    A.buildings[f] = {}
    for (const key of [...UNIT_ORDER, ...extraUnits]) {
      jobs.push([`Einheiten: ${key}`, () => {
        const um = unitModel(key, f)
        const inf = key === 'rifle' || key === 'at' || key === 'sniper' || key === 'engineer' || key === 'mortar' || key === 'medic'
        const dirs = inf ? 16 : 32
        const hull = new Rot(um.hull, dirs)
        const art: UnitArt = {
          hull,
          mount: um.mount ?? [0, 0, 0],
          muzzle: um.muzzle ?? [6, 3],
          rotor: um.rotor,
          burner: um.burner,
          icon: makeCanvas(1, 1),
        }
        if (inf) {
          art.alt = new Rot(um.alt!, dirs, {}, false)
          art.alt2 = new Rot(um.alt2!, dirs, {}, false)
          art.aim = new Rot(um.aim!, dirs, {}, false)
        } else {
          if (um.turret) art.turret = new Rot(um.turret, 32, {}, false)
          if (um.turretAnim) art.turretAnim = um.turretAnim.map((t) => new Rot(t, 32, {}, false))
          if (um.hull2) art.hull2 = new Rot(um.hull2, dirs, {}, false)
          if (um.hullAnim) art.hullAnim = um.hullAnim.map((h) => new Rot(h, dirs, {}, false))
          if (um.alt) art.alt = new Rot(um.alt, dirs, {}, false)
          if (key !== 'jet') {
            art.wreck = new Rot(um.hull, 16, { dark: 0.42 }, false)
            if (um.turret) art.wreckTurret = new Rot(um.turret, 16, { dark: 0.42 }, false)
          }
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
    A.title = renderSprite(titleModel('PIXELFRONT'), -Math.PI / 4)
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
