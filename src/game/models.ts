// Every model in the game, built voxel by voxel in code.
//
// Vehicles: x runs across (0 = left side), y along (the nose is at the high end), z up.
// Buildings are written in world axes (x = world x, y = world y) through BVox, which swaps the
// first two axes so a building needs no turning when it is drawn.

import { Vox } from '../core/voxel'
import { shade, mix, hex } from '../core/iso'
import { valueNoise, hash3, mulberry32 } from '../core/rng'
import { SCHEMES, COL, type Faction, type Scheme } from './colors'

/** a model written in world axes */
export class BVox extends Vox {
  constructor(wx: number, wy: number, h: number) {
    super(wy, wx, h)
  }
  protected override put(fx: number, fy: number, fz: number, v: number) {
    super.put(fy, fx, fz, v)
  }
}

export { unitModel, type UnitModel } from './units3d'

// ─────────────────────────────────────────────────────────── buildings

function slab(m: Vox, x0: number, y0: number, x1: number, y1: number, c = COL.concrete2) {
  m.box(x0, y0, 0, x1, y1, 0, c)
  m.paint((x, y, z, cc) => (z === 0 && cc === c && hash3(x, y, 9) < 0.12 ? shade(c, 0.93) : cc))
}

function windowsX(m: Vox, x0: number, x1: number, y: number, z0: number, z1: number, step: number, lit = 0.25) {
  for (let x = x0; x <= x1; x += step)
    for (let z = z0; z <= z1; z++) m.set(x, y, z, hash3(x, z, y) < lit ? COL.windowLit : COL.window, hash3(x, z, y) < lit)
}
function windowsY(m: Vox, y0: number, y1: number, x: number, z0: number, z1: number, step: number, lit = 0.25) {
  for (let y = y0; y <= y1; y += step)
    for (let z = z0; z <= z1; z++) m.set(x, y, z, hash3(y, z, x) < lit ? COL.windowLit : COL.window, hash3(y, z, x) < lit)
}

function flag(m: Vox, x: number, y: number, h: number, s: Scheme) {
  m.box(x, y, 1, x, y, h, COL.steel)
  m.box(x, y + 1, h - 4, x, y + 5, h - 1, s.team)
  m.box(x, y + 1, h - 4, x, y + 5, h - 4, s.teamDark)
}

function sandbags(m: Vox, pts: [number, number][], h = 2) {
  for (const [x, y] of pts) for (let z = 1; z <= h; z++) m.set(x, y, z, hash3(x, y, z) < 0.3 ? shade(COL.sandbag, 0.88) : COL.sandbag)
}

// ─────────────────────────────────────────────────────────── life round the buildings

/** a soldier or worker standing about (world axes, about 4 units tall) */
function person(m: Vox, x: number, y: number, s: Scheme | null, shirt?: number) {
  const uni = s ? shade(s.uniform, 1.1) : shirt ?? hex('5a7aa8')
  m.box(x, y, 1, x, y, 2, s ? shade(s.uniform2, 1.05) : hex('3a3e44'))
  m.box(x, y, 3, x, y, 3.5, shirt ?? uni)
  m.dot(x + 0.25, y + 0.25, 4.5, COL.skin)
  m.box(x, y, 5, x, y, 5, s ? s.helmet : COL.hazard)
}

/** a light military car (Wolf / UAZ) parked along x or y */
function jeep(m: Vox, x: number, y: number, s: Scheme, alongX: boolean) {
  const [w, l] = alongX ? [5, 3] : [3, 5]
  m.box(x, y, 1, x + w - 1, y + l - 1, 2, s.base)
  if (alongX) m.box(x + 1, y, 3, x + 3, y + l - 1, 3.5, s.dark)
  else m.box(x, y + 1, 3, x + w - 1, y + 3, 3.5, s.dark)
  m.box(alongX ? x + 3.5 : x, alongX ? y : y + 3.5, 3, alongX ? x + 3.5 : x + w - 1, alongX ? y + l - 1 : y + 3.5, 3.5, COL.window)
  for (const [a, b] of alongX ? [[x + 0.5, y], [x + 3.5, y], [x + 0.5, y + l - 0.5], [x + 3.5, y + l - 0.5]] : [[x, y + 0.5], [x, y + 3.5], [x + w - 0.5, y + 0.5], [x + w - 0.5, y + 3.5]])
    m.box(a, b, 0.5, a + 0.5, b + 0.5, 1.5, hex('1f1f1d'))
  m.dot(alongX ? x + w - 0.5 : x + 0.5, alongX ? y + 0.5 : y + l - 0.5, 1.5, hex('fff1b0'), true)
  m.dot(alongX ? x + w - 0.5 : x + w - 1, alongX ? y + l - 1 : y + l - 0.5, 1.5, hex('fff1b0'), true)
}

/** a stack of wooden crates */
function crates(m: Vox, x: number, y: number, n = 3) {
  for (let k = 0; k < n; k++) {
    const cx = x + (k % 2) * 2, cy = y + Math.floor(k / 2) * 2, cz = 1 + (k === n - 1 && n > 2 ? 2 : 0)
    m.box(cx, cy, cz, cx + 1.5, cy + 1.5, cz + 1.5, k % 2 ? COL.wood : COL.wood2)
    m.box(cx, cy, cz + 1.5, cx + 1.5, cy + 1.5, cz + 1.5, shade(COL.wood, 1.15))
  }
}

/** oil drums standing together */
function drums(m: Vox, x: number, y: number, c = hex('3f5a3a')) {
  for (const [dx, dy] of [[0, 0], [1.5, 0], [0.75, 1.5]]) {
    m.cylZ(x + dx + 0.5, y + dy + 0.5, 0.7, 1, 2.5, c)
    m.dot(x + dx + 0.5, y + dy + 0.5, 3, shade(c, 1.3))
  }
}

/** a lamp post with its light */
function lamp(m: Vox, x: number, y: number, h = 7) {
  m.rod(x, y, 1, x, y, h, COL.steelDark)
  m.rod(x, y, h, x + 1, y + 1, h, COL.steelDark)
  m.dot(x + 1, y + 1, h - 0.5, COL.windowLit, true)
}

/** an air-conditioning box on a roof */
function aircon(m: Vox, x: number, y: number, z: number) {
  m.box(x, y, z, x + 2, y + 1.5, z + 1, COL.concrete3)
  m.cylZ(x + 1, y + 0.75, 0.6, z + 1.5, z + 1.5, COL.steelDark)
}

/** a satellite dish on a roof */
function satDish(m: Vox, x: number, y: number, z: number) {
  m.rod(x, y, z, x, y, z + 1, COL.steelDark)
  m.ball(x + 0.5, y + 0.5, z + 2, 1.2, 1.2, 1.2, COL.white)
  m.box(x, y, z + 1.5, x + 1, y + 1, z + 2.5, -1)
  m.box(x, y, z + 1, x + 0.5, y + 0.5, z + 1.5, COL.white)
}

/** a red warning light for low-flying aircraft */
function beacon(m: Vox, x: number, y: number, z: number) {
  m.dot(x, y, z, hex('ff3a2a'), true)
}

function hq(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(48, 48, 34)
  slab(m, 1, 1, 46, 46)
  // main block
  m.box(5, 6, 1, 38, 38, 13, COL.concrete)
  m.box(5, 6, 14, 38, 38, 14, COL.concrete2)
  m.box(6, 7, 14, 37, 37, 14, -1)
  m.box(6, 7, 13, 37, 37, 13, COL.asphalt)
  windowsX(m, 7, 36, 38, 4, 5, 3)
  windowsX(m, 7, 36, 38, 9, 10, 3)
  windowsY(m, 8, 36, 38, 4, 5, 3)
  windowsY(m, 8, 36, 38, 9, 10, 3)
  // entrance
  m.box(18, 38, 1, 25, 41, 7, COL.concrete3)
  m.box(19, 41, 1, 24, 41, 5, COL.window)
  m.box(16, 41, 8, 27, 43, 8, COL.concrete2)
  // tower with the command post
  m.box(9, 10, 14, 22, 23, 23, COL.concrete3)
  windowsX(m, 10, 21, 23, 18, 20, 1, 0.5)
  windowsY(m, 11, 22, 22, 18, 20, 1, 0.5)
  m.box(8, 9, 24, 23, 24, 24, COL.concrete2)
  m.box(13, 14, 25, 15, 16, 30, COL.steel)
  m.ball(14, 15, 31, 4, 1.2, 2.3, COL.steel)
  // antennas
  m.box(30, 12, 14, 30, 12, 30, COL.steelDark)
  m.box(33, 28, 14, 33, 28, 24, COL.steelDark)
  // team bands
  m.box(5, 38, 12, 38, 38, 12, s.team)
  m.box(38, 6, 12, 38, 38, 12, s.team)
  // sandbags at the corners
  const bags: [number, number][] = []
  for (let i = 0; i < 7; i++) bags.push([40 + i, 42], [42, 40 + i])
  sandbags(m, bags)
  flag(m, 44, 4, 30, s)
  // on the roof: air conditioning, dishes, antennas with lights
  aircon(m, 26, 26, 14)
  aircon(m, 30, 18, 14)
  satDish(m, 26, 9, 14)
  satDish(m, 33, 31, 14)
  beacon(m, 30, 12, 31)
  beacon(m, 14, 15, 33.5)
  // the guard at the door, a car, lamps, a barrier
  person(m, 17, 43, s)
  person(m, 26, 43, s)
  jeep(m, 30, 41, s, true)
  lamp(m, 15, 44)
  lamp(m, 28, 44)
  m.box(8, 44, 2, 14, 44, 2, COL.hazard)
  m.box(8, 44, 1, 8, 44, 2, COL.steelDark)
  person(m, 41, 39, s)
  return m
}

function power(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(32, 32, 36)
  slab(m, 1, 1, 30, 30)
  m.box(2, 3, 1, 16, 28, 11, COL.brick)
  m.paint((x, y, z, c) => (c === COL.brick && z % 3 === 0 ? COL.brickDark : c))
  m.box(2, 3, 12, 16, 28, 12, COL.roofDark)
  windowsY(m, 5, 26, 16, 5, 8, 3, 0.4)
  windowsX(m, 4, 14, 28, 5, 8, 3, 0.4)
  // chimney with bands
  for (let z = 1; z <= 33; z++) {
    const r = 2.6 - z * 0.02
    m.cylZ(23, 8, r, z, z, z > 26 ? (Math.floor(z / 2) % 2 ? COL.white : COL.brick) : COL.concrete)
  }
  // transformers and insulators
  for (const [x, y] of [[20, 17], [26, 17], [20, 24], [26, 24]] as [number, number][]) {
    m.box(x, y, 1, x + 3, y + 3, 5, COL.steelDark)
    m.box(x + 1, y + 1, 6, x + 1, y + 1, 8, COL.white)
    m.box(x + 2, y + 2, 6, x + 2, y + 2, 8, COL.white)
    m.set(x + 1, y + 1, 9, s.teamLight, true)
  }
  m.box(18, 16, 1, 18, 29, 2, COL.steel)
  m.box(2, 28, 10, 16, 28, 10, s.team)
  // ladder and red lights on the chimney, pipes to the yard, a fence, the night shift
  for (let z = 3; z <= 31; z += 1) m.dot(25.5, 8, z, COL.steelDark)
  beacon(m, 23, 5.5, 33.5)
  beacon(m, 23, 10.5, 27)
  m.rod(16, 20, 8, 20, 20, 8, COL.steel)
  m.rod(16, 26, 8, 20, 26, 8, COL.steel)
  m.rod(16, 20, 6, 16, 26, 6, COL.steel)
  for (let k = 19; k <= 30; k += 2) m.rod(k, 30, 1, k, 30, 4, COL.steelDark)
  m.rod(19, 30, 4, 30, 30, 4, COL.steelDark)
  m.rod(30, 15, 4, 30, 30, 4, COL.steelDark)
  for (let k = 15; k <= 30; k += 2) m.rod(30, k, 1, 30, k, 4, COL.steelDark)
  m.box(17, 29, 2, 18, 29, 3, COL.hazard) // warning sign
  person(m, 22, 13, null, COL.hazard)
  aircon(m, 5, 6, 12)
  aircon(m, 9, 18, 12)
  lamp(m, 17, 13)
  return m
}

function refinery(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(48, 48, 30)
  slab(m, 1, 1, 46, 46)
  // warehouse with a curved roof
  m.box(3, 4, 1, 28, 30, 9, COL.steel)
  m.paint((x, y, z, c) => (c === COL.steel && (x + y) % 4 === 0 ? shade(COL.steel, 0.9) : c))
  for (let x = 3; x <= 28; x++) {
    const t = (x - 15.5) / 13
    const top = 9 + Math.round(6 * Math.sqrt(Math.max(0, 1 - t * t)))
    m.box(x, 4, 9, x, 30, top, (x & 1) ? COL.steelDark : shade(COL.steelDark, 0.9))
  }
  m.box(10, 30, 1, 21, 30, 7, COL.window)
  m.box(28, 12, 1, 28, 22, 7, COL.window)
  // silos
  for (const y of [7, 19]) {
    m.cylZ(39, y, 5.2, 1, 22, COL.concrete3)
    m.cylZ(39, y, 5.6, 23, 24, COL.concrete2)
    m.cylZ(39, y, 2, 25, 27, COL.steel)
  }
  m.box(30, 6, 18, 36, 7, 19, COL.steelDark) // conveyor
  // unloading bay
  m.box(31, 30, 0, 46, 46, 0, COL.asphalt)
  for (let i = 31; i <= 46; i += 2) {
    m.set(i, 30, 0, COL.hazard)
    m.set(31, i - 1, 0, COL.hazard)
  }
  m.box(34, 33, 1, 43, 34, 6, COL.steelDark)
  m.box(34, 33, 7, 43, 43, 7, COL.steel)
  m.box(34, 43, 1, 34, 43, 6, COL.steelDark)
  m.box(43, 43, 1, 43, 43, 6, COL.steelDark)
  m.box(3, 30, 8, 28, 30, 8, s.team)
  flag(m, 2, 42, 22, s)
  // ladders on the silos, the conveyor's legs, workers, a forklift, crates and drums, lamps
  for (const y of [7, 19]) for (let z = 2; z <= 24; z++) m.dot(44.5, y, z, COL.steelDark)
  for (const x of [31, 34]) m.rod(x, 6.5, 1, x, 6.5, 18, COL.steelDark)
  beacon(m, 39, 7, 28)
  person(m, 37, 38, null, COL.hazard)
  person(m, 24, 34, null, hex('e07a2a'))
  m.box(20, 36, 1, 22, 38, 2, COL.hazard) // forklift
  m.box(20, 38.5, 1, 22, 38.5, 4, COL.steelDark)
  m.box(20.5, 36.5, 3, 21.5, 37, 3.5, COL.black)
  crates(m, 6, 35, 4)
  drums(m, 13, 40)
  lamp(m, 31, 29, 8)
  lamp(m, 45, 31, 8)
  aircon(m, 8, 10, 15)
  return m
}

function barracks(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(32, 32, 26)
  slab(m, 1, 1, 30, 30, COL.sand)
  m.box(3, 5, 1, 26, 19, 7, f === 'nato' ? COL.concrete : COL.wall2)
  windowsX(m, 5, 25, 19, 3, 4, 3, 0.3)
  m.box(13, 19, 1, 16, 19, 5, COL.wood2)
  // gable roof along x
  for (let i = 0; i <= 8; i++) m.box(2, 4 + i, 8 + i, 27, 20 - i, 8 + i, i % 2 ? s.camo2 : s.base)
  m.box(2, 12, 16, 27, 12, 16, s.dark)
  const bags: [number, number][] = []
  for (let x = 3; x <= 27; x++) bags.push([x, 25])
  for (let y = 21; y <= 25; y++) bags.push([28, y])
  sandbags(m, bags, 3)
  flag(m, 29, 3, 24, s)
  m.box(26, 6, 1, 26, 18, 6, s.team)
  // soldiers at drill on the yard, their sergeant, a water tank, a jeep, lamps, a chimney
  for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) person(m, 8 + k * 2, 21.5 + r * 1.5, s)
  person(m, 17, 22.5, s)
  m.cylZ(5, 27, 1.5, 1, 4, COL.steel)
  m.rod(5, 27, 4, 5, 27, 5, COL.steelDark)
  jeep(m, 20, 26.5, s, true)
  lamp(m, 12, 20.5)
  m.box(6, 9, 13, 7, 10, 17, COL.brick)
  m.dot(6.5, 9.5, 18, hex('8a8a84'))
  for (let x = 5; x <= 25; x += 3) m.dot(x, 19.25, 6, COL.windowLit, true) // the lamp over each window
  return m
}

function factory(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(48, 48, 30)
  slab(m, 1, 1, 46, 46)
  m.box(3, 3, 1, 44, 33, 14, COL.concrete)
  m.paint((x, y, z, c) => (c === COL.concrete && z === 7 ? COL.concrete2 : c))
  // saw-tooth roof
  for (let x = 3; x <= 44; x++) {
    const k = (x - 3) % 8
    m.box(x, 3, 15, x, 33, 15 + Math.min(k, 5), k === 0 ? COL.glass : COL.steelDark)
    if (k === 7) m.box(x, 3, 15, x, 33, 20, COL.window)
  }
  m.box(13, 33, 1, 34, 33, 11, COL.asphalt) // big door
  for (let z = 2; z <= 11; z += 2) m.box(13, 33, z, 34, 33, z, shade(COL.asphalt, 0.8))
  m.box(13, 33, 12, 34, 33, 12, COL.hazard)
  windowsY(m, 6, 30, 44, 4, 6, 4, 0.35)
  // crane gantry over the yard
  m.box(4, 36, 1, 4, 36, 18, COL.hazard)
  m.box(43, 36, 1, 43, 36, 18, COL.hazard)
  m.box(4, 36, 19, 43, 36, 19, COL.hazard)
  m.box(22, 36, 15, 23, 36, 18, COL.steelDark)
  // chimney
  m.cylZ(40, 7, 2, 21, 27, COL.brick)
  m.box(3, 33, 13, 44, 33, 13, s.team)
  for (let i = 4; i < 44; i += 2) m.set(i, 46, 0, COL.hazard)
  // a new vehicle rolling out of the big door, the crane's hook, workers, floodlights, roof vents
  m.box(19, 35, 1, 27, 40, 3, s.base)
  m.box(21, 36, 4, 25, 39, 5, s.dark)
  m.rod(23, 39, 5, 23, 44, 5, s.dark)
  for (const x of [19, 27]) m.box(x, 35, 0.5, x, 40, 1.5, hex('2a2a26'))
  m.rod(22.5, 36, 15, 22.5, 36, 9, COL.steelDark)
  m.box(22, 35.5, 8, 23, 36.5, 8.5, COL.hazard)
  person(m, 16, 38, null, hex('e07a2a'))
  person(m, 30, 37, null, hex('5a7aa8'))
  person(m, 29, 41, s)
  for (const x of [8, 39]) {
    m.rod(x, 34, 1, x, 34, 12, COL.steelDark)
    m.box(x - 0.5, 34, 12, x + 0.5, 34.5, 12.5, COL.windowLit, true)
  }
  for (let x = 6; x <= 42; x += 8) m.box(x, 20, 21, x + 1, 21, 22, COL.steel)
  drums(m, 40, 40, COL.hazard)
  crates(m, 5, 40, 3)
  beacon(m, 40, 7, 28)
  return m
}

function radar(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(32, 32, 36)
  slab(m, 1, 1, 30, 30)
  m.box(4, 4, 1, 21, 21, 9, COL.concrete3)
  windowsX(m, 6, 20, 21, 5, 6, 2, 0.4)
  windowsY(m, 6, 20, 21, 5, 6, 2, 0.4)
  m.box(4, 4, 10, 21, 21, 10, COL.concrete2)
  // lattice mast
  for (let z = 11; z <= 22; z++) {
    m.set(11, 11, z, COL.steelDark)
    m.set(14, 14, z, COL.steelDark)
    if (z % 3 === 0) m.box(11, 11, z, 14, 14, z, COL.steel)
  }
  // dish, tilted towards the sky
  for (let a = -8; a <= 8; a++)
    for (let b = -5; b <= 5; b++) {
      const d = (a * a) / 64 + (b * b) / 25
      if (d > 1) continue
      m.set(12.5 + a * 0.7 + b * 0.5, 12.5 - a * 0.7 + b * 0.5, 27 + b * 0.8 + d * 2, d > 0.75 ? COL.steelDark : COL.white)
    }
  m.box(12, 12, 23, 13, 13, 27, COL.steel)
  m.set(13, 13, 31, s.team, true)
  // generator
  m.box(23, 21, 1, 28, 28, 5, s.base)
  m.box(24, 22, 6, 25, 23, 8, COL.steelDark)
  flag(m, 27, 3, 20, s)
  // a warning light on the mast, whip antennas, cables to the generator, operators, a car, a fence
  beacon(m, 12.5, 12.5, 23)
  m.rod(6, 6, 11, 6, 6, 18, COL.steelDark)
  m.rod(19, 6, 11, 19, 6, 16, COL.steelDark)
  m.rod(21, 18, 2, 23, 24, 2, COL.black)
  for (let x = 6; x <= 18; x += 4) m.dot(x, 21.5, 7.5, COL.windowLit, true)
  person(m, 15, 24, s)
  person(m, 9, 23, null, hex('5a7aa8'))
  jeep(m, 3, 25, s, true)
  for (let k = 2; k <= 29; k += 3) m.rod(29.5, k, 1, 29.5, k, 3.5, COL.steelDark)
  m.rod(29.5, 2, 3.5, 29.5, 29, 3.5, COL.steelDark)
  aircon(m, 16, 6, 11)
  return m
}

function helipad(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(32, 32, 20)
  m.box(1, 1, 0, 30, 30, 1, COL.concrete2)
  // H and circle
  for (let a = 0; a < 64; a++) {
    const t = (a / 64) * Math.PI * 2
    m.set(16 + Math.cos(t) * 10, 16 + Math.sin(t) * 10, 1, COL.hazard)
  }
  m.box(11, 11, 1, 12, 20, 1, COL.white)
  m.box(19, 11, 1, 20, 20, 1, COL.white)
  m.box(13, 15, 1, 18, 16, 1, COL.white)
  for (let i = 1; i <= 30; i += 4) {
    m.set(i, 1, 2, COL.white, true)
    m.set(1, i, 2, COL.white, true)
  }
  // control hut and fuel tank
  m.box(24, 2, 1, 30, 8, 9, COL.concrete3)
  m.box(24, 2, 10, 30, 8, 12, COL.glass)
  m.box(24, 2, 13, 30, 8, 13, COL.concrete2)
  m.box(27, 5, 14, 27, 5, 18, COL.steelDark)
  m.set(27, 5, 18, s.team, true)
  m.cylY(4, 4, 2.5, 22, 29, COL.steel)
  m.box(24, 8, 9, 30, 8, 9, s.team)
  // a windsock, the fuel hose, ground crew, a fuel bowser, landing lights round the circle
  m.rod(29, 29, 1, 29, 29, 9, COL.steelDark)
  for (let k = 0; k < 4; k++) m.box(29 - k, 29, 8.5 - k * 0.25, 29 - k, 29.5, 9 - k * 0.25, k % 2 ? COL.white : hex('e07a2a'))
  m.rod(6, 25, 2, 12, 23, 1, COL.black)
  person(m, 22, 14, s)
  person(m, 9, 9, null, COL.hazard)
  m.box(2, 12, 1, 4, 18, 3, s.base)
  m.box(2, 17, 3, 4, 18, 4, s.dark)
  m.cylY(3, 3.5, 1, 12, 16, COL.steel)
  for (let a = 0; a < 8; a++) {
    const t = (a / 8) * Math.PI * 2
    m.dot(16 + Math.cos(t) * 11.5, 16 + Math.sin(t) * 11.5, 2, hex('5aff7a'), true)
  }
  m.dot(25, 5, 11, COL.windowLit, true)
  return m
}

function bunker(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(16, 16, 10)
  m.cylZ(8, 8, 7, 0, 2, COL.concrete2)
  m.cylZ(8, 8, 6.5, 3, 4, COL.concrete)
  m.cylZ(8, 8, 5, 5, 5, COL.concrete3)
  for (let a = 0; a < 24; a++) {
    const t = (a / 24) * Math.PI * 2
    m.set(8 + Math.cos(t) * 6.5, 8 + Math.sin(t) * 6.5, 3, COL.black)
  }
  m.set(8, 15, 1, s.team)
  m.set(15, 8, 1, s.team)
  // sandbags at the entrance, an ammunition box, a periscope and an antenna on the roof
  sandbags(m, [[13, 13], [14, 12], [12, 14], [14, 13], [13, 14]], 2)
  m.box(2, 12, 1, 3, 13, 2, hex('4a5634'))
  m.box(5, 6, 6, 5, 6, 7, COL.steelDark)
  m.rod(11, 5, 6, 11, 5, 9.5, COL.steelDark)
  return m
}
function bunkerGun(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new Vox(5, 10, 3)
  m.box(1, 0, 0, 3, 4, 1, s.base)
  m.rod(2.5, 4, 1.5, 2.5, 9, 1.5, s.metal)
  m.box(3, 1, 1, 3.5, 2, 1.5, hex('4a5634')) // ammunition box
  m.box(1, 3.5, 1.5, 3, 3.5, 2, COL.steelDark) // the gun shield
  m.set(2, 1, 2, s.team)
  m.px = 2.5
  m.py = 2.5
  return m
}

function rocketSite(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(16, 16, 6)
  const bags: [number, number][] = []
  for (let a = 0; a < 40; a++) {
    const t = (a / 40) * Math.PI * 2
    bags.push([Math.round(8 + Math.cos(t) * 6.8), Math.round(8 + Math.sin(t) * 6.8)])
  }
  m.box(2, 2, 0, 13, 13, 0, COL.sand)
  sandbags(m, bags, 2)
  m.set(8, 15, 1, s.team)
  m.box(3, 10, 1, 4.5, 11, 1.5, hex('4a5634')) // reload crates
  m.box(3, 8.5, 1, 4.5, 9.5, 1.5, hex('4a5634'))
  return m
}
function rocketLauncher(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new Vox(10, 10, 7)
  m.box(4, 3, 0, 5, 5, 2, COL.steelDark)
  m.box(0, 2, 3, 3, 9, 5, s.base)
  m.box(6, 2, 3, 9, 9, 5, s.base)
  m.set(1, 9, 4, s.track); m.set(2, 9, 4, s.track)
  m.set(7, 9, 4, s.track); m.set(8, 9, 4, s.track)
  m.box(4, 3, 3, 5, 6, 4, s.team)
  for (const x of [1, 2, 7, 8]) m.dot(x + 0.25, 9.5, 4.25, hex('c8cac0')) // missile noses
  m.box(4, 2, 5, 5, 2.5, 6, COL.steelDark) // the sight
  m.dot(4.5, 2.75, 5.5, COL.window, true)
  m.px = 5
  m.py = 4.5
  return m
}

export interface BuildingModel {
  body: Vox
  turret?: Vox
  mount?: [number, number, number]
}

export function buildingModel(key: string, f: Faction): BuildingModel {
  switch (key) {
    case 'hq': return { body: hq(f) }
    case 'power': return { body: power(f) }
    case 'ref': return { body: refinery(f) }
    case 'barracks': return { body: barracks(f) }
    case 'factory': return { body: factory(f) }
    case 'radar': return { body: radar(f) }
    case 'helipad': return { body: helipad(f) }
    case 'bunker': return { body: bunker(f), turret: bunkerGun(f), mount: [0, 0, 6] }
    case 'rocket': return { body: rocketSite(f), turret: rocketLauncher(f), mount: [0, 0, 1] }
    case 'airfield': return { body: airfield(f) }
    case 'shipyard': return { body: shipyard(f) }
  }
  throw new Error('unknown building ' + key)
}

// ─────────────────────────────────────────────────────────── the landscape

export function treeModel(kind: 'oak' | 'pine' | 'birch' | 'bush', seed: number): Vox {
  const r = mulberry32(seed * 7919 + 13)
  const m = new Vox(16, 16, 26)
  m.px = 8
  m.py = 8
  if (kind === 'pine') {
    const top = 18 + Math.floor(r() * 6)
    m.box(7, 7, 0, 8, 8, 4, COL.trunk)
    for (let z = 3; z <= top; z++) {
      const k = (top - z) / (top - 3)
      const rad = 0.8 + k * 5.2 + (z % 3 === 0 ? 0.6 : 0)
      m.cylZ(8, 8, rad, z, z, z % 3 === 0 ? COL.pine3 : r() < 0.5 ? COL.pine1 : COL.pine2)
    }
    m.paint((x, y, z, c) => (c !== COL.trunk && hash3(x, y, z + seed) < 0.06 ? -1 : c))
    // cones hanging under the boughs
    for (let i = 0; i < 6; i++) {
      const z = 5 + r() * (top - 8), a = r() * Math.PI * 2, k = (top - z) / (top - 3)
      m.dot(8 + Math.cos(a) * (k * 5 + 0.6), 8 + Math.sin(a) * (k * 5 + 0.6), z - 0.5, hex('6a4a2a'))
    }
    return m
  }
  if (kind === 'bush') {
    m.ball(8, 8, 2.5, 4, 3.5, 3, COL.leaf2)
    m.paint((x, y, z, c) => {
      const h = hash3(x, y, z + seed)
      return h < 0.3 ? COL.leaf1 : h > 0.8 ? COL.leaf3 : h > 0.785 ? hex('b8322a') : c
    })
    return m
  }
  const birch = kind === 'birch'
  const th = birch ? 9 : 6
  m.box(7, 7, 0, 8, 8, th, birch ? COL.white : COL.trunk)
  if (birch) for (let z = 1; z < th; z += 2) m.set(7, 8, z, COL.black)
  else {
    // bark: dark furrows, roots spreading at the foot
    for (let z = 0; z < th; z += 1) m.dot(8.75, 7.25 + (z % 2) * 0.75, z + 0.25, shade(COL.trunk, 0.75))
    for (const [dx, dy] of [[1, 0], [-1, 0.5], [0.5, 1], [0, -1]]) m.rod(7.75, 7.75, 0.5, 7.75 + dx * 1.8, 7.75 + dy * 1.8, 0, shade(COL.trunk, 0.9))
  }
  // boughs reaching into the crown
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2 + 0.6
    m.rod(7.75, 7.75, th - 1, 7.75 + Math.cos(a) * 3.5, 7.75 + Math.sin(a) * 3.5, th + 3.5, birch ? COL.white : COL.trunk)
  }
  const cz = th + 5 + r() * 2
  const rad = birch ? 4.2 : 6.2 + r() * 1.3
  const autumn = r() < 0.12
  const blobs = 4
  for (let i = 0; i < blobs; i++) {
    const a = r() * Math.PI * 2
    m.ball(8 + Math.cos(a) * 2.2, 8 + Math.sin(a) * 2.2, cz + (r() - 0.3) * 3, rad * 0.75, rad * 0.75, rad * 0.62, COL.leaf2)
  }
  m.ball(8, 8, cz + 1, rad, rad, rad * 0.75, COL.leaf2)
  m.paint((x, y, z, c) => {
    if (c !== COL.leaf2) return c
    const n = valueNoise(x, y + z, 2.5, seed)
    const h = hash3(x, y, z + seed)
    if (h < 0.05) return -1
    let col = n < 0.3 ? COL.leaf1 : n > 0.7 ? COL.leaf3 : COL.leaf2
    if (z > cz + 3 && h > 0.6) col = COL.leaf4
    if (autumn && n > 0.5) col = mix(col, COL.autumn, 0.6)
    if (birch) col = mix(col, COL.leaf4, 0.3)
    return col
  })
  return m
}

export function houseModel(kind: 'house' | 'timber' | 'church' | 'barn', seed: number): Vox {
  const r = mulberry32(seed + 101)
  const m = new BVox(16, 16, 34)
  const along = r() < 0.5 // ridge along world x or y
  const wall = kind === 'timber' ? COL.wall : r() < 0.5 ? COL.wall : COL.wall2
  const roof = r() < 0.7 ? COL.roof : COL.roof2
  if (kind === 'church') {
    m.box(1, 4, 0, 10, 11, 9, COL.white)
    for (let i = 0; i <= 5; i++) m.box(1, 3 + i, 10 + i, 10, 12 - i, 10 + i, COL.roofDark)
    windowsY(m, 5, 10, 10, 4, 7, 2, 0)
    windowsX(m, 3, 9, 11, 4, 7, 3, 0)
    m.box(10, 4, 0, 15, 10, 21, COL.white)
    m.box(11, 10, 15, 13, 10, 17, COL.window)
    m.box(15, 6, 15, 15, 8, 17, COL.window)
    m.set(12, 10, 19, COL.yellow) // the clock
    for (let z = 22; z <= 31; z++) {
      const k = Math.max(0, 3 - (z - 22) * 0.34)
      m.box(Math.round(12.5 - k), Math.round(7 - k), z, Math.round(12.5 + k), Math.round(7 + k), z, COL.copper)
    }
    m.box(12, 7, 32, 12, 7, 33, COL.yellow)
    m.box(11.5, 7, 33.5, 12.5, 7, 33.5, COL.yellow) // the cross bar
    // clock faces, louvres of the belfry, the portal with steps, a lantern
    for (const [x, y, ax] of [[12, 10.5, false], [15.5, 7, true]] as [number, number, boolean][]) {
      m.box(ax ? x : x - 0.5, ax ? y - 0.5 : y, 18.5, ax ? x : x + 1, ax ? y + 1 : y, 19.5, COL.white)
      m.dot(ax ? x + 0.25 : x + 0.25, ax ? y + 0.25 : y + 0.25, 19.25, COL.black)
    }
    for (let z = 15; z <= 17; z += 1) {
      m.dot(11.5, 10.5, z, hex('2a2826'))
      m.dot(13, 10.5, z, hex('2a2826'))
      m.dot(15.5, 6.5, z, hex('2a2826'))
      m.dot(15.5, 8, z, hex('2a2826'))
    }
    m.box(4, 11, 0, 6, 11, 4, COL.wood2)
    m.box(4, 11, 4.5, 6, 11, 4.5, hex('c8c2b0'))
    m.box(3.5, 11.5, 0, 6.5, 12.5, 0, COL.concrete3)
    m.dot(5.25, 12, 5.5, COL.windowLit, true)
    // the churchyard: stones, little crosses, a yew
    for (const [x, y] of [[2, 13.5], [4.5, 14], [7, 13.5], [9, 14.5], [2.5, 15], [11.5, 13.5]] as [number, number][]) {
      m.box(x, y, 0, x + 0.5, y, 1, COL.rock3)
      m.dot(x - 0.25, y, 0.75, COL.rock3)
      m.dot(x + 0.75, y, 0.75, COL.rock3)
    }
    m.ball(14, 14, 2, 1.6, 1.6, 2.2, COL.pine1)
    for (let x = 0.5; x <= 15.5; x += 1.5) m.dot(x, 15.5, 0.5, COL.rock2) // a low wall
    return m
  }
  const h = kind === 'barn' ? 6 : 6 + Math.floor(r() * 3)
  const x0 = 2, x1 = 13, y0 = 3, y1 = 12
  m.box(x0, y0, 0, x1, y1, h, kind === 'barn' ? COL.wood : wall)
  if (kind === 'timber') {
    m.paint((x, y, z, c) => {
      if (c !== wall) return c
      const edgeX = x === x0 || x === x1
      const edgeY = y === y0 || y === y1
      if ((edgeX && (y - y0) % 3 === 0) || (edgeY && (x - x0) % 3 === 0) || z === 0 || z === 4 || z === h) return COL.timber
      return c
    })
  }
  if (kind === 'barn') {
    m.paint((x, y, z, c) => (c === COL.wood && (x + y) % 2 === 0 ? COL.wood2 : c))
    m.box(6, y1, 0, 9, y1, 4, COL.wood2)
  } else {
    windowsX(m, x0 + 2, x1 - 1, y1, 2, 3, 3, 0.15)
    windowsY(m, y0 + 2, y1 - 1, x1, 2, 3, 3, 0.15)
    if (h > 6) {
      windowsX(m, x0 + 2, x1 - 1, y1, 5, 6, 3, 0.2)
      windowsY(m, y0 + 2, y1 - 1, x1, 5, 6, 3, 0.2)
    }
    m.box(7, y1, 0, 8, y1, 3, COL.wood2)
  }
  const rc = kind === 'barn' ? COL.roofDark : roof
  if (along) {
    for (let i = 0; i <= 6; i++) m.box(x0 - 1, y0 - 1 + i, h + 1 + i, x1 + 1, y1 + 1 - i, h + 1 + i, i % 2 ? rc : shade(rc, 0.92))
  } else {
    for (let i = 0; i <= 6; i++) m.box(x0 - 1 + i, y0 - 1, h + 1 + i, x1 + 1 - i, y1 + 1, h + 1 + i, i % 2 ? rc : shade(rc, 0.92))
  }
  if (kind !== 'barn') m.box(4, 5, h + 2, 5, 6, h + 7, COL.brick)
  const q = mulberry32(seed * 977 + 31)
  if (kind === 'barn') {
    // hay showing in the loft door, a bale and a plough outside
    m.box(6.5, y1, 5, 8.5, y1, 6, COL.hay)
    m.box(6.5, y1 + 0.5, 4.5, 8.5, y1 + 0.5, 4.5, COL.wood2)
    m.cylX(14.5, 1.5, 1.4, 10, 12.5, COL.hay)
    m.rod(2, 14, 1, 5, 14.5, 1, COL.steelDark)
    for (const x of [2.5, 3.5, 4.5]) m.rod(x, 14.5, 1, x, 15, 0, COL.steelDark)
    m.box(4, y1 + 0.5, 0, 5, y1 + 0.5, 3, COL.wood) // the open door leaf
    return m
  }
  // the chimney's cap, gutters along the eaves
  m.box(3.5, 4.5, h + 7.5, 5.5, 6.5, h + 7.5, COL.concrete2)
  if (along) {
    m.rod(x0 - 1, y1 + 1.5, h + 0.75, x1 + 1, y1 + 1.5, h + 0.75, COL.steel)
    m.rod(x1 + 1, y1 + 1.5, h + 0.75, x1 + 1, y1 + 1.5, 0.5, COL.steel) // the downpipe
  } else {
    m.rod(x1 + 1.5, y0 - 1, h + 0.75, x1 + 1.5, y1 + 1, h + 0.75, COL.steel)
    m.rod(x1 + 1.5, y1 + 1, h + 0.75, x1 + 1.5, y1 + 1, 0.5, COL.steel)
  }
  // shutters beside the windows, flower boxes below some
  const shut = q() < 0.5 ? hex('3f6a3a') : q() < 0.5 ? hex('6a4a2a') : hex('5a6a7a')
  const flowers = [hex('c8322a'), hex('e8a0c0'), hex('f0c840')]
  for (let x = x0 + 2; x <= x1 - 1; x += 3) {
    if (x === 7 || x === 8) continue
    for (let zz = 2; zz < 4; zz += 0.5) {
      m.dot(x - 0.5, y1 + 1, zz, shut)
      m.dot(x + 1, y1 + 1, zz, shut)
    }
    if (q() < 0.6) m.box(x, y1 + 1, 1.5, x + 0.5, y1 + 1, 1.5, flowers[Math.floor(q() * 3)])
  }
  for (let y = y0 + 2; y <= y1 - 1; y += 3)
    for (let zz = 2; zz < 4; zz += 0.5) {
      m.dot(x1 + 1, y - 0.5, zz, shut)
      m.dot(x1 + 1, y + 1, zz, shut)
    }
  // the front door: step, handle, a lamp above
  m.box(6.5, y1 + 1, 0, 9, y1 + 2, 0, COL.concrete3)
  m.dot(8.5, y1 + 1, 1.5, COL.yellow)
  m.dot(7.75, y1 + 1, 4, COL.windowLit, true)
  // a garden: fence along the front with its gate, a letter box, a bush, sometimes a dish
  for (let x = 0.5; x <= 15.5; x += 1) if (x < 6 || x > 9.5) m.rod(x, 15.5, 0, x, 15.5, 1.5, COL.white)
  m.rod(0.5, 15.5, 1.25, 5.5, 15.5, 1.25, COL.white)
  m.rod(10.5, 15.5, 1.25, 15.5, 15.5, 1.25, COL.white)
  m.box(10, 15, 1.5, 10.5, 15.5, 2, hex('c8322a'))
  m.rod(10.25, 15.25, 0, 10.25, 15.25, 1.5, COL.steelDark)
  m.ball(14, 14, 1.2, 1.4, 1.4, 1.3, q() < 0.5 ? COL.leaf2 : COL.leaf3)
  if (q() < 0.35) {
    m.box(x1, 6, h + 1, x1 + 0.5, 6.5, h + 1.5, COL.steelDark)
    m.ball(x1 + 1, 6.5, h + 2, 0.9, 0.9, 0.9, COL.white)
  }
  if (kind === 'timber' && q() < 0.6) m.cylZ(1.5, 14, 0.9, 0, 1.5, hex('5a4636')) // a rain barrel
  return m
}

export function oreModel(stage: number, seed: number): Vox {
  const r = mulberry32(seed * 31 + stage)
  const m = new Vox(16, 16, 8)
  m.px = 8
  m.py = 8
  const n = 2 + stage * 2
  for (let i = 0; i < n; i++) {
    const x = 3 + r() * 10, y = 3 + r() * 10
    const s = 1.2 + r() * (0.8 + stage * 0.5)
    m.ball(x, y, 0.5, s, s, s * 0.9, r() < 0.4 ? COL.rock : COL.rock2)
  }
  m.paint((x, y, z, c) => {
    const h = hash3(x, y, z + seed)
    if (h < 0.28) return COL.ore
    if (h < 0.36) return COL.ore3
    if (h < 0.42) return COL.ore2
    return c
  })
  // crystals poking out of the rocks, catching the light
  for (let i = 0; i < 2 + stage * 2; i++) {
    const x = 3 + r() * 10, y = 3 + r() * 10, hgt = 1.5 + r() * (1 + stage)
    m.rod(x, y, 0.5, x + (r() - 0.5), y + (r() - 0.5), hgt, COL.ore3)
    m.dot(x + 0.25, y + 0.25, 0.5 + hgt * 0.5, COL.ore, true)
  }
  return m
}

// ─────────────────────────────────────────────────────────── airfields and shipyards

function airfield(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(64, 48, 22)
  m.box(1, 1, 0, 62, 46, 0, COL.concrete2)
  // runway along x with markings
  m.box(1, 3, 0, 62, 16, 0, COL.asphalt)
  for (let x = 4; x < 60; x += 6) m.box(x, 9, 0, x + 2, 10, 0, COL.white)
  for (const x of [3, 59]) for (let y = 5; y <= 14; y += 2) m.set(x, y, 0, COL.white)
  for (let x = 1; x <= 62; x += 3) {
    m.set(x, 2, 1, COL.hazard, true)
    m.set(x, 17, 1, COL.hazard, true)
  }
  // parking spots
  for (const x of [9, 27, 45]) {
    for (let k = -7; k <= 7; k++) {
      m.set(x + k, 26, 0, COL.hazard)
      m.set(x + k, 45, 0, COL.hazard)
    }
    m.box(x - 8, 26, 0, x - 8, 45, 0, COL.hazard)
  }
  // hangar and tower
  for (let x = 55; x <= 62; x++) {
    const t = (x - 58.5) / 4
    const top = Math.round(8 * Math.sqrt(Math.max(0, 1 - t * t)))
    m.box(x, 24, 1, x, 45, Math.max(1, top), x % 2 ? COL.steel : COL.steelDark)
  }
  m.box(56, 45, 1, 61, 45, 5, COL.asphalt)
  m.box(52, 20, 1, 56, 23, 14, COL.concrete3)
  m.box(51, 19, 15, 57, 24, 17, COL.glass)
  m.box(51, 19, 18, 57, 24, 18, COL.concrete2)
  m.box(54, 21, 19, 54, 21, 21, COL.steelDark)
  m.set(54, 21, 21, s.team, true)
  m.box(1, 45, 1, 8, 46, 1, s.team)
  // approach lights, a fuel truck, a tug, ground crew, the windsock, the tower's lit windows
  for (let y = 4; y <= 15; y += 2) {
    m.dot(0.5, y, 1, hex('5aff7a'), true)
    m.dot(62.5, y, 1, hex('ff3a2a'), true)
  }
  m.box(48, 30, 1, 52, 34, 3, s.base)
  m.cylX(31.5, 3.5, 1.3, 48, 51, COL.steel)
  m.box(52, 30, 1, 53, 34, 4, s.dark)
  m.box(22, 40, 1, 24, 42, 2, COL.hazard)
  person(m, 20, 38, null, COL.hazard)
  person(m, 37, 30, null, hex('4a9a4a'))
  person(m, 47, 41, s)
  m.rod(50, 20, 1, 50, 20, 8, COL.steelDark)
  for (let k = 0; k < 4; k++) m.box(50 - k, 20, 7.5 - k * 0.25, 50 - k, 20.5, 8 - k * 0.25, k % 2 ? COL.white : hex('e07a2a'))
  for (let x = 52; x <= 56; x += 2) m.dot(x, 23.5, 10, COL.windowLit, true)
  beacon(m, 54, 21, 22)
  drums(m, 44, 43)
  return m
}

function shipyard(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new BVox(48, 48, 30)
  m.box(1, 1, 0, 46, 46, 0, COL.concrete2)
  // slipway with a hull being built
  m.box(4, 16, 0, 43, 31, 0, COL.asphalt)
  for (let x = 6; x <= 40; x++) {
    const t = Math.abs(x - 23) / 18
    const half = Math.round(5 * Math.sqrt(Math.max(0, 1 - t * t * t)))
    m.box(x, 24 - half, 1, x, 24 + half, 4, x > 30 ? COL.rust : s.navy2)
    if (x % 4 === 0) m.box(x, 18, 1, x, 30, 5, COL.steelDark)
  }
  // crane gantry over the slipway
  for (const x of [5, 42]) {
    m.box(x, 14, 1, x, 14, 22, COL.hazard)
    m.box(x, 33, 1, x, 33, 22, COL.hazard)
  }
  m.box(5, 14, 23, 42, 14, 23, COL.hazard)
  m.box(5, 33, 23, 42, 33, 23, COL.hazard)
  m.box(20, 14, 22, 23, 33, 22, COL.steelDark)
  m.box(21, 24, 12, 21, 24, 21, COL.steelDark)
  // workshop
  m.box(4, 36, 1, 30, 46, 10, COL.brick)
  m.box(4, 36, 11, 30, 46, 11, COL.roofDark)
  windowsX(m, 6, 28, 46, 4, 6, 3, 0.4)
  m.box(34, 37, 1, 44, 45, 6, COL.concrete3)
  m.box(4, 2, 1, 44, 3, 2, COL.concrete3) // quay wall
  for (let x = 6; x < 44; x += 6) m.box(x, 4, 1, x, 4, 2, COL.black) // bollards
  m.box(4, 46, 9, 30, 46, 9, s.team)
  flag(m, 46, 36, 20, s)
  // the hook and its cable, welders' sparks on the hull, workers, scaffolding, lamps, stacked plates
  m.rod(21.5, 24, 11, 21.5, 24, 8, COL.steelDark)
  m.box(21, 23.5, 7, 22, 24.5, 7.5, COL.hazard)
  for (const [x, y, z] of [[12, 19, 3], [28, 29, 4], [33, 20, 3]]) m.dot(x, y, z, hex('fff6d8'), true)
  person(m, 12, 17, null, hex('e07a2a'))
  person(m, 30, 31, null, COL.hazard)
  person(m, 38, 26, null, hex('5a7aa8'))
  for (let x = 8; x <= 38; x += 6) {
    m.rod(x, 17.5, 1, x, 17.5, 6, COL.steel)
    m.rod(x, 30.5, 1, x, 30.5, 6, COL.steel)
  }
  m.rod(8, 17.5, 6, 38, 17.5, 6, COL.steel)
  m.rod(8, 30.5, 6, 38, 30.5, 6, COL.steel)
  for (const x of [4, 43]) {
    m.rod(x, 34, 1, x, 34, 12, COL.steelDark)
    m.box(x - 0.5, 34, 12, x + 0.5, 34.5, 12.5, COL.windowLit, true)
  }
  for (let k = 0; k < 4; k++) m.box(35, 39 + k * 0.5, 7 + k * 0.5, 43, 44, 7 + k * 0.5, shade(COL.steel, 0.9 + k * 0.05))
  crates(m, 32, 31, 3)
  beacon(m, 23.5, 14, 24)
  return m
}

// ─────────────────────────────────────────────────────────── the title

const GLYPHS: Record<string, string[]> = {
  P: ['1111 ', '1   1', '1   1', '1111 ', '1    ', '1    ', '1    '],
  I: ['111', ' 1 ', ' 1 ', ' 1 ', ' 1 ', ' 1 ', '111'],
  X: ['1   1', '1   1', ' 1 1 ', '  1  ', ' 1 1 ', '1   1', '1   1'],
  E: ['11111', '1    ', '1    ', '1111 ', '1    ', '1    ', '11111'],
  L: ['1    ', '1    ', '1    ', '1    ', '1    ', '1    ', '11111'],
  F: ['11111', '1    ', '1    ', '1111 ', '1    ', '1    ', '1    '],
  R: ['1111 ', '1   1', '1   1', '1111 ', '1 1  ', '1  1 ', '1   1'],
  O: [' 111 ', '1   1', '1   1', '1   1', '1   1', '1   1', ' 111 '],
  N: ['1   1', '11  1', '1 1 1', '1  11', '1   1', '1   1', '1   1'],
  T: ['11111', '  1  ', '  1  ', '  1  ', '  1  ', '  1  ', '  1  '],
}

/** chunky voxel letters, standing up and facing the viewer */
export function titleModel(text: string): Vox {
  const B = 3
  let width = 0
  for (const ch of text) width += (GLYPHS[ch]?.[0].length ?? 3) + 1
  const m = new Vox(5, width * B + 2, 7 * B + 2)
  let y0 = 1
  const gold = COL.yellow, gold2 = shade(COL.yellow, 0.7)
  for (const ch of text) {
    const g = GLYPHS[ch]
    if (!g) {
      y0 += 4 * B
      continue
    }
    for (let row = 0; row < 7; row++)
      for (let col = 0; col < g[row].length; col++) {
        if (g[row][col] !== '1') continue
        const z = (6 - row) * B + 1
        m.box(0, y0 + col * B, z, 3, y0 + col * B + B - 1, z + B - 1, gold)
        m.box(0, y0 + col * B, z, 0, y0 + col * B + B - 1, z + B - 1, gold2)
      }
    y0 += (g[0].length + 1) * B
  }
  m.px = 2.5
  m.py = m.l / 2
  m.pz = 0
  return m
}
