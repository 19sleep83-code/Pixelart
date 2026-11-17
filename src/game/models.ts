// Every model in the game, built voxel by voxel in code.
//
// Vehicles: x runs across (0 = left side), y along (the nose is at the high end), z up.
// Buildings are written in world axes (x = world x, y = world y) through BVox, which swaps the
// first two axes so a building needs no turning when it is drawn.

import { Vox } from '../core/voxel'
import { shade, mix } from '../core/iso'
import { valueNoise, hash3, mulberry32 } from '../core/rng'
import { SCHEMES, COL, type Faction, type Scheme } from './colors'

/** a model written in world axes */
export class BVox extends Vox {
  constructor(wx: number, wy: number, h: number) {
    super(wy, wx, h)
  }
  override set(x: number, y: number, z: number, c: number, glow = false) {
    super.set(y, x, z, c, glow)
  }
}

function camo(m: Vox, s: Scheme, seed: number, cell = 4) {
  m.paint((x, y, z, c) => {
    if (c !== s.base) return c
    const n = valueNoise(x + z * 0.6, y + z * 0.4, cell, seed)
    return n < 0.32 ? s.camo2 : n > 0.7 ? s.camo3 : s.base
  })
}

/** two tracks with road wheels, from y0 to y1 */
function tracks(m: Vox, xl: number, xr: number, tw: number, y0: number, y1: number, h: number, s: Scheme) {
  for (const x0 of [xl, xr - tw + 1]) {
    m.box(x0, y0, 0, x0 + tw - 1, y1, h - 1, s.track)
    // round the ends
    m.box(x0, y0, 0, x0 + tw - 1, y0, 0, -1)
    m.box(x0, y1, 0, x0 + tw - 1, y1, 0, -1)
    // wheels on the outer face
    const xo = x0 === xl ? xl : xr
    for (let y = y0 + 2; y <= y1 - 2; y += 3) m.set(xo, y, 1, shade(s.metal, 1.35))
  }
}

// ─────────────────────────────────────────────────────────── vehicles

export interface UnitModel {
  hull: Vox
  turret?: Vox
  /** where the turret's pivot sits on the hull, in voxels from the hull's pivot (across, along, up) */
  mount?: [number, number, number]
  /** extra: the second look of a harvester (loaded), the second step of a walk */
  alt?: Vox
  /** where shots leave, relative to the turret (or hull) pivot: along, up */
  muzzle?: [number, number]
  rotor?: { r: number; z: number; tail: number }
}

function mbt(f: Faction): UnitModel {
  const s = SCHEMES[f]
  const hull = new Vox(12, 21, 6)
  tracks(hull, 0, 11, 3, 1, 19, 3, s)
  hull.box(1, 0, 2, 10, 20, 4, s.base)
  if (f === 'nato') {
    // flat, angular glacis
    hull.box(1, 19, 4, 10, 20, 4, -1)
    hull.box(1, 20, 3, 10, 20, 3, -1)
    hull.box(0, 2, 2, 0, 18, 3, s.base)
    hull.box(11, 2, 2, 11, 18, 3, s.base)
  } else {
    // a long sloped nose with blocks of reactive armour
    hull.box(1, 17, 4, 10, 20, 4, -1)
    hull.box(1, 19, 3, 10, 20, 3, -1)
    for (let x = 2; x <= 9; x += 2) hull.set(x, 17, 3, shade(s.base, 0.85))
    hull.box(0, 3, 2, 0, 17, 2, s.camo3)
    hull.box(11, 3, 2, 11, 17, 2, s.camo3)
    // fuel drums at the back
    hull.cylX(0.5, 4.5, 1.2, 2, 9, shade(s.base, 0.8))
  }
  hull.box(3, 1, 4, 8, 2, 5, s.dark) // engine deck
  hull.box(2, 1, 4, 2, 1, 4, s.team)
  hull.box(9, 1, 4, 9, 1, 4, s.team)
  camo(hull, s, f === 'nato' ? 11 : 12)
  hull.py = 10.5

  let turret: Vox
  if (f === 'nato') {
    turret = new Vox(10, 22, 5)
    turret.box(0, 0, 0, 9, 9, 2, s.base)
    turret.box(0, 9, 0, 0, 9, 2, -1)
    turret.box(9, 9, 0, 9, 9, 2, -1)
    turret.box(1, 0, 3, 3, 2, 3, s.dark) // hatch
    turret.box(6, 1, 3, 7, 2, 3, s.metal) // sight
    turret.box(0, 3, 1, 0, 5, 1, s.team)
    turret.box(9, 3, 1, 9, 5, 1, s.team)
    turret.box(4, 9, 0, 5, 11, 2, s.dark) // mantlet
    turret.box(4, 11, 1, 5, 21, 1, s.metal) // gun
    turret.box(4, 15, 1, 5, 16, 2, s.metal) // evacuator
    turret.px = 5
    turret.py = 5
  } else {
    turret = new Vox(10, 22, 5)
    turret.ball(5, 5, 0.6, 4.6, 4.8, 2.7, s.base)
    turret.box(0, 0, -1, 9, 10, -1, -1)
    turret.box(2, 1, 3, 3, 2, 3, s.dark)
    turret.box(6, 3, 3, 7, 4, 3, s.metal)
    turret.box(0, 4, 1, 0, 5, 1, s.team)
    turret.box(9, 4, 1, 9, 5, 1, s.team)
    turret.box(4, 9, 0, 5, 10, 1, s.dark)
    turret.box(4, 10, 1, 5, 21, 1, s.metal)
    turret.px = 5
    turret.py = 5
  }
  camo(turret, s, 21)
  return { hull, turret, mount: [0, -1.5, 5], muzzle: [16, 1.5] }
}

function ifv(f: Faction): UnitModel {
  const s = SCHEMES[f]
  const hull = new Vox(11, 18, 8)
  tracks(hull, 0, 10, 2, 1, 16, 3, s)
  if (f === 'nato') {
    hull.box(1, 0, 2, 9, 17, 6, s.base)
    hull.box(1, 15, 6, 9, 17, 6, -1)
    hull.box(1, 16, 5, 9, 17, 5, -1)
    hull.box(1, 17, 4, 9, 17, 4, -1)
    hull.box(2, 0, 3, 8, 0, 5, s.dark) // rear ramp
    for (let y = 3; y <= 12; y += 3) hull.set(0, y, 4, s.glass) // firing ports
    for (let y = 3; y <= 12; y += 3) hull.set(10, y, 4, s.glass)
  } else {
    hull.box(1, 0, 2, 9, 17, 4, s.base)
    // long low wedge
    for (let y = 10; y <= 17; y++) {
      const top = 4 - Math.floor((y - 10) / 3)
      hull.box(1, y, top + 1, 9, y, 6, -1)
    }
    hull.box(1, 0, 2, 9, 9, 5, s.base)
    hull.box(1, 0, 5, 2, 9, 5, -1)
    hull.box(8, 0, 5, 9, 9, 5, -1)
    hull.box(3, 0, 5, 7, 2, 5, s.dark)
  }
  hull.box(1, 1, 3, 1, 2, 3, s.team)
  hull.box(9, 1, 3, 9, 2, 3, s.team)
  camo(hull, s, f === 'nato' ? 31 : 32)
  hull.py = 9

  const turret = new Vox(7, 16, 4)
  if (f === 'nato') {
    turret.box(0, 0, 0, 6, 6, 2, s.base)
    turret.box(0, 6, 2, 6, 6, 2, -1)
    turret.box(3, 6, 1, 3, 13, 1, s.metal)
    turret.box(6, 2, 1, 6, 3, 2, s.dark) // missile box
    turret.box(1, 1, 3, 2, 2, 3, s.dark)
  } else {
    turret.ball(3.5, 3.5, 0.4, 3.2, 3.2, 2.4, s.base)
    turret.box(0, 0, -1, 6, 7, -1, -1)
    turret.box(3, 6, 1, 3, 14, 1, s.metal)
    turret.box(1, 1, 2, 2, 2, 2, s.dark)
  }
  turret.px = 3.5
  turret.py = 3.5
  camo(turret, s, 33)
  return { hull, turret, mount: [0, f === 'nato' ? 1 : 0, f === 'nato' ? 7 : 5], muzzle: [10, 1.5] }
}

function artillery(f: Faction): UnitModel {
  const s = SCHEMES[f]
  if (f === 'nato') {
    const hull = new Vox(12, 22, 6)
    tracks(hull, 0, 11, 3, 1, 20, 3, s)
    hull.box(1, 0, 2, 10, 21, 4, s.base)
    hull.box(1, 20, 4, 10, 21, 4, -1)
    hull.box(1, 21, 3, 10, 21, 3, -1)
    hull.box(2, 1, 3, 9, 1, 3, s.team)
    camo(hull, s, 41)
    hull.py = 11
    const turret = new Vox(11, 28, 7)
    turret.box(0, 0, 0, 10, 11, 4, s.base)
    turret.box(0, 11, 4, 10, 11, 4, -1)
    turret.box(4, 11, 1, 6, 13, 3, s.dark)
    turret.box(5, 13, 2, 5, 27, 2, s.metal)
    turret.box(4, 25, 1, 6, 27, 3, s.metal) // muzzle brake
    turret.box(1, 2, 5, 3, 4, 5, s.dark)
    turret.box(0, 4, 2, 0, 7, 2, s.team)
    turret.box(10, 4, 2, 10, 7, 2, s.team)
    turret.px = 5.5
    turret.py = 5
    camo(turret, s, 42)
    return { hull, turret, mount: [0, -4, 5], muzzle: [22, 2.5] }
  }
  // a rocket launcher on a six-wheeled truck
  const hull = new Vox(10, 22, 9)
  for (const y of [3, 7, 11, 18]) {
    hull.cylX(y + 0.5, 1.5, 1.6, 0, 1, s.track)
    hull.cylX(y + 0.5, 1.5, 1.6, 8, 9, s.track)
  }
  hull.box(1, 1, 2, 8, 20, 2, s.dark)
  hull.box(1, 15, 3, 8, 21, 7, s.base) // cab
  hull.box(1, 21, 5, 8, 21, 6, s.glass)
  hull.box(1, 20, 7, 8, 21, 7, -1)
  hull.box(0, 17, 5, 0, 19, 6, s.glass)
  hull.box(9, 17, 5, 9, 19, 6, s.glass)
  hull.box(1, 1, 3, 8, 13, 3, s.base)
  hull.box(3, 16, 7, 6, 18, 7, s.team)
  camo(hull, s, 43)
  hull.py = 11
  const turret = new Vox(9, 13, 5)
  turret.box(0, 0, 0, 8, 12, 4, s.base)
  for (let x = 1; x <= 7; x += 2) for (let z = 1; z <= 3; z += 2) turret.set(x, 12, z, s.track)
  turret.box(0, 0, 4, 8, 0, 4, s.dark)
  turret.px = 4.5
  turret.py = 6
  camo(turret, s, 44)
  return { hull, turret, mount: [0, -4, 4], muzzle: [7, 3] }
}

function flak(f: Faction): UnitModel {
  const s = SCHEMES[f]
  const hull = new Vox(11, 19, 6)
  tracks(hull, 0, 10, 3, 1, 17, 3, s)
  hull.box(1, 0, 2, 9, 18, 4, s.base)
  hull.box(1, 17, 4, 9, 18, 4, -1)
  hull.box(1, 18, 3, 9, 18, 3, -1)
  hull.box(1, 1, 3, 9, 1, 3, s.team)
  camo(hull, s, 51)
  hull.py = 9.5
  const turret = new Vox(13, 16, 10)
  turret.box(2, 0, 0, 10, 8, 4, s.base)
  turret.box(2, 8, 4, 10, 8, 4, -1)
  if (f === 'nato') {
    // twin guns on the turret's sides and two radars
    turret.box(0, 3, 2, 1, 6, 3, s.dark)
    turret.box(11, 3, 2, 12, 6, 3, s.dark)
    turret.box(0, 6, 3, 0, 15, 3, s.metal)
    turret.box(12, 6, 3, 12, 15, 3, s.metal)
    turret.box(5, 0, 5, 7, 1, 6, s.dark)
    turret.box(4, 0, 7, 8, 0, 9, s.metal) // search radar
    turret.box(5, 8, 5, 7, 9, 6, s.metal) // tracking radar
  } else {
    // missile tubes and guns
    turret.box(0, 2, 2, 1, 9, 3, s.camo2)
    turret.box(11, 2, 2, 12, 9, 3, s.camo2)
    turret.set(0, 9, 2, s.track); turret.set(1, 9, 3, s.track)
    turret.set(11, 9, 2, s.track); turret.set(12, 9, 3, s.track)
    turret.box(3, 8, 2, 3, 14, 2, s.metal)
    turret.box(9, 8, 2, 9, 14, 2, s.metal)
    turret.box(5, 0, 5, 7, 2, 6, s.dark)
    turret.ball(6.5, 1, 8, 3.2, 0.8, 1.8, s.metal) // radar dish
  }
  turret.box(2, 3, 2, 2, 5, 2, s.team)
  turret.box(10, 3, 2, 10, 5, 2, s.team)
  turret.px = 6.5
  turret.py = 4.5
  camo(turret, s, 52)
  return { hull, turret, mount: [0, -2, 5], muzzle: [11, 3] }
}

function harvester(f: Faction, loaded: boolean): Vox {
  const s = SCHEMES[f]
  const m = new Vox(10, 20, 10)
  for (const y of [3, 7, 15]) {
    m.cylX(y + 0.5, 1.5, 1.7, 0, 1, s.track)
    m.cylX(y + 0.5, 1.5, 1.7, 8, 9, s.track)
  }
  m.box(1, 1, 2, 8, 19, 2, s.dark)
  // cab
  m.box(1, 14, 3, 8, 19, 8, COL.hazard)
  m.box(1, 19, 5, 8, 19, 7, s.glass)
  m.box(0, 16, 6, 0, 18, 7, s.glass)
  m.box(9, 16, 6, 9, 18, 7, s.glass)
  m.box(2, 14, 9, 7, 17, 9, s.team)
  m.box(1, 19, 3, 8, 19, 3, s.metal)
  // tipper body
  m.box(1, 1, 3, 8, 12, 3, shade(COL.hazard, 0.85))
  m.box(1, 1, 4, 1, 12, 8, shade(COL.hazard, 0.9))
  m.box(8, 1, 4, 8, 12, 8, shade(COL.hazard, 0.9))
  m.box(1, 1, 4, 8, 1, 8, shade(COL.hazard, 0.8))
  m.box(1, 12, 4, 8, 12, 8, shade(COL.hazard, 0.8))
  for (let y = 2; y <= 11; y += 3) {
    m.set(0, y, 6, s.dark)
    m.set(9, y, 6, s.dark)
  }
  if (loaded) {
    const r = mulberry32(5)
    for (let y = 2; y <= 11; y++)
      for (let x = 2; x <= 7; x++) {
        const h = 7 + Math.round(2.2 - Math.abs(y - 6.5) * 0.3 - Math.abs(x - 4.5) * 0.4 + r())
        m.box(x, y, 4, x, y, h, r() < 0.3 ? COL.ore2 : r() < 0.5 ? COL.ore3 : COL.ore)
      }
  }
  m.py = 10
  return m
}

function soldier(f: Faction, step: number, at: boolean): Vox {
  const s = SCHEMES[f]
  const m = new Vox(7, 7, 10)
  const legA = step === 0 ? 3 : step === 1 ? 4 : 2
  const legB = step === 0 ? 3 : step === 1 ? 2 : 4
  m.box(2, legA, 0, 2, legA, 2, s.uniform2)
  m.box(4, legB, 0, 4, legB, 2, s.uniform2)
  m.box(2, 3, 2, 4, 3, 2, s.uniform2)
  m.box(2, 3, 3, 4, 3, 5, s.uniform) // body
  m.box(2, 2, 3, 4, 2, 5, s.uniform2) // pack
  m.set(1, 3, 4, s.uniform)
  m.set(5, 3, 4, s.uniform)
  m.set(1, 3, 5, s.team)
  m.set(5, 3, 5, s.team)
  m.set(3, 3, 6, COL.skin)
  m.box(2, 2, 7, 4, 4, 7, s.helmet)
  m.set(3, 3, 7, s.helmet)
  m.set(3, 3, 8, s.helmet)
  if (at) {
    m.box(5, 0, 6, 5, 6, 6, s.camo2)
    m.set(5, 6, 6, s.team)
    m.set(5, 0, 6, s.dark)
  } else {
    m.box(4, 4, 4, 4, 6, 4, s.metal)
  }
  m.py = 3.5
  m.px = 3.5
  return m
}

function heli(f: Faction): UnitModel {
  const s = SCHEMES[f]
  if (f === 'nato') {
    const m = new Vox(14, 28, 11)
    m.box(5, 6, 2, 8, 20, 5, s.base) // fuselage
    m.box(6, 21, 2, 7, 23, 4, s.base)
    m.box(6, 22, 5, 7, 23, 5, s.glass)
    m.box(6, 17, 6, 7, 21, 7, s.glass) // tandem canopy
    m.box(6, 18, 6, 7, 18, 7, s.dark)
    m.box(4, 9, 5, 9, 14, 6, s.dark) // engines
    m.box(6, 11, 7, 7, 12, 8, s.metal) // mast
    m.box(6, 0, 4, 7, 6, 5, s.base) // tail boom
    m.box(6, 0, 6, 7, 2, 9, s.base) // fin
    m.box(8, 1, 7, 8, 1, 7, s.metal)
    m.box(0, 12, 4, 13, 13, 4, s.dark) // stub wings
    m.box(0, 11, 2, 1, 15, 3, s.metal) // pods
    m.box(12, 11, 2, 13, 15, 3, s.metal)
    m.box(6, 21, 1, 7, 22, 1, s.metal) // chin gun
    m.set(5, 8, 4, s.team); m.set(8, 8, 4, s.team)
    m.box(6, 3, 5, 7, 4, 5, s.team)
    camo(m, s, 61, 3)
    m.py = 13
    m.px = 7
    return { hull: m, rotor: { r: 15, z: 9, tail: 12.5 }, muzzle: [12, 2] }
  }
  const m = new Vox(18, 30, 12)
  m.box(6, 7, 2, 11, 22, 7, s.base)
  m.box(7, 23, 2, 10, 26, 5, s.base)
  m.box(7, 26, 3, 10, 26, 4, s.glass) // front bubble
  m.box(7, 23, 6, 10, 24, 6, s.glass) // rear bubble
  m.box(7, 21, 7, 10, 22, 7, s.glass)
  m.box(6, 12, 8, 11, 18, 8, s.dark) // engines
  m.box(8, 14, 9, 9, 15, 10, s.metal)
  m.box(8, 0, 5, 9, 7, 6, s.base)
  m.box(8, 0, 7, 9, 2, 10, s.base)
  m.box(1, 13, 5, 16, 15, 5, s.dark) // wings
  m.box(0, 12, 3, 2, 16, 4, s.metal)
  m.box(15, 12, 3, 17, 16, 4, s.metal)
  m.box(8, 25, 1, 9, 26, 1, s.metal)
  m.box(6, 10, 6, 6, 12, 6, s.team)
  m.box(11, 10, 6, 11, 12, 6, s.team)
  camo(m, s, 62, 3)
  m.py = 14
  m.px = 9
  return { hull: m, rotor: { r: 17, z: 10, tail: 13.5 }, muzzle: [13, 2] }
}

export function unitModel(key: string, f: Faction): UnitModel {
  switch (key) {
    case 'mbt': return mbt(f)
    case 'ifv': return ifv(f)
    case 'art': return artillery(f)
    case 'aa': return flak(f)
    case 'harv': return { hull: harvester(f, false), alt: harvester(f, true) }
    case 'rifle': return { hull: soldier(f, 0, false), alt: soldier(f, 1, false), turret: soldier(f, 2, false), muzzle: [3, 4] }
    case 'at': return { hull: soldier(f, 0, true), alt: soldier(f, 1, true), turret: soldier(f, 2, true), muzzle: [4, 6] }
    case 'heli': return heli(f)
  }
  throw new Error('unknown unit ' + key)
}

// ─────────────────────────────────────────────────────────── buildings

function slab(m: Vox, x0: number, y0: number, x1: number, y1: number, c = COL.concrete2) {
  m.box(x0, y0, 0, x1, y1, 0, c)
  m.paint((x, y, z, cc) => (z === 0 && cc === c && hash3(x, y, 9) < 0.12 ? shade(c, 0.93) : cc))
}

function windowsX(m: Vox, x0: number, x1: number, y: number, z0: number, z1: number, step: number, lit = 0.25) {
  for (let x = x0; x <= x1; x += step)
    for (let z = z0; z <= z1; z++) m.set(x, y, z, hash3(x, z, y) < lit ? COL.windowLit : COL.window, false)
}
function windowsY(m: Vox, y0: number, y1: number, x: number, z0: number, z1: number, step: number, lit = 0.25) {
  for (let y = y0; y <= y1; y += step)
    for (let z = z0; z <= z1; z++) m.set(x, y, z, hash3(y, z, x) < lit ? COL.windowLit : COL.window, false)
}

function flag(m: Vox, x: number, y: number, h: number, s: Scheme) {
  m.box(x, y, 1, x, y, h, COL.steel)
  m.box(x, y + 1, h - 4, x, y + 5, h - 1, s.team)
  m.box(x, y + 1, h - 4, x, y + 5, h - 4, s.teamDark)
}

function sandbags(m: Vox, pts: [number, number][], h = 2) {
  for (const [x, y] of pts) for (let z = 1; z <= h; z++) m.set(x, y, z, hash3(x, y, z) < 0.3 ? shade(COL.sandbag, 0.88) : COL.sandbag)
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
  return m
}
function bunkerGun(f: Faction): Vox {
  const s = SCHEMES[f]
  const m = new Vox(5, 10, 3)
  m.box(1, 0, 0, 3, 4, 1, s.base)
  m.box(2, 4, 1, 2, 9, 1, s.metal)
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
    return m
  }
  if (kind === 'bush') {
    m.ball(8, 8, 2.5, 4, 3.5, 3, COL.leaf2)
    m.paint((x, y, z, c) => {
      const h = hash3(x, y, z + seed)
      return h < 0.3 ? COL.leaf1 : h > 0.8 ? COL.leaf3 : c
    })
    return m
  }
  const birch = kind === 'birch'
  const th = birch ? 9 : 6
  m.box(7, 7, 0, 8, 8, th, birch ? COL.white : COL.trunk)
  if (birch) for (let z = 1; z < th; z += 2) m.set(7, 8, z, COL.black)
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
  return m
}
