// The units, modelled after their real counterparts at a finer voxel scale: road wheels and track
// links, hatches, periscopes, smoke dischargers, antennas, stowage, reactive armour; railings,
// radars, launch cells and lifeboats on the ships; kit and weapons on the soldiers.
//
// Axes as everywhere: x across (0 = left side), y along (the nose at the high end), z up.
// Frames for animation: tracks that run while driving, radars that turn, soldiers that walk and aim.

import { Vox } from '../core/voxel'
import { shade, mix, hex } from '../core/iso'
import { valueNoise, hash3 } from '../core/rng'
import { SCHEMES, COL, type Faction, type Scheme } from './colors'

export interface UnitModel {
  hull: Vox
  /** the hull with the tracks one link further on (alternates while driving) */
  hull2?: Vox
  /** hull frames cycled all the time (a ship's turning radar) */
  hullAnim?: Vox[]
  turret?: Vox
  /** turret frames cycled all the time (a flak tank's turning radar) */
  turretAnim?: Vox[]
  /** where the turret's pivot sits on the hull, in voxels from the hull's pivot (across, along, up) */
  mount?: [number, number, number]
  /** a harvester's loaded look, the first step of a walk */
  alt?: Vox
  /** the second step of a walk */
  alt2?: Vox
  /** a soldier taking aim */
  aim?: Vox
  muzzle?: [number, number]
  rotor?: { r: number; z: number; tail: number }
}

// ─────────────────────────────────────────────────────────── a kit of parts

const GUN = hex('35383a')
const GUN_HI = hex('5a5f62')
const RUBBER = hex('1f1f1d')
const LIGHT = hex('fff1b0')
const RED_LAMP = hex('ff5a40')

/** paint the base colour in the faction's camouflage */
function camo(m: Vox, s: Scheme, f: Faction, seed: number) {
  m.paint((x, y, z, c) => {
    if (c !== s.base) return c
    if (f === 'nato') {
      // Flecktarn: small blotches of three colours
      const n = valueNoise(x + z * 0.7, y - z * 0.5, 2.6, seed)
      const d = hash3(x, y, z + seed)
      if (d < 0.07) return s.dark
      return n < 0.3 ? s.camo2 : n > 0.68 ? s.camo3 : s.base
    }
    // plain Russian green with a few faded patches
    const n = valueNoise(x + z * 0.5, y + z * 0.3, 5, seed)
    return n > 0.72 ? s.camo2 : n < 0.22 ? shade(s.base, 0.9) : s.base
  })
}

/** cut away everything above a sloping line in the y–z plane (glacis plates, sloped noses) */
function slope(m: Vox, y0: number, z0: number, y1: number, z1: number) {
  const a = Math.min(y0, y1), b = Math.max(y0, y1)
  for (let y = a; y <= b; y++) {
    const t = (y - y0) / (y1 - y0 || 1)
    const top = Math.round(z0 + (z1 - z0) * t)
    m.box(0, y, top + 1, m.w - 1, y, m.h - 1, -1)
  }
}

/**
 * Tracks with road wheels, a drive sprocket and an idler. `phase` moves the links by one,
 * which is all it takes to make them run.
 */
function tracks(m: Vox, s: Scheme, opt: { x0: number; x1: number; tw: number; y0: number; y1: number; h: number; wheels: number; phase: number; skirt?: number }) {
  const { x0, x1, tw, y0, y1, h, wheels, phase } = opt
  const link = s.track, link2 = shade(s.track, 1.45)
  for (const left of [true, false]) {
    const xa = left ? x0 : x1 - tw + 1, xb = left ? x0 + tw - 1 : x1
    for (let y = y0; y <= y1; y++)
      for (let z = 0; z < h; z++) {
        // rounded ends
        if ((y === y0 || y === y1) && (z === 0 || z === h - 1)) continue
        if ((y === y0 + 1 || y === y1 - 1) && z === 0) continue
        const edge = z === 0 || z === h - 1 || y === y0 || y === y1
        const c = edge && (y + z + phase) % 2 === 0 ? link2 : link
        m.box(xa, y, z, xb, y, z, edge ? c : shade(link, 0.85))
      }
    // the wheels on the outer face
    const xo = left ? xa - 1 : xb + 1
    const span = y1 - y0 - 5
    for (let k = 0; k < wheels; k++) {
      const cy = y0 + 3 + (span * k) / Math.max(1, wheels - 1)
      m.cylX(cy, 1.6, 1.5, xo, xo, GUN)
      m.set(xo, Math.round(cy - 0.5), 1, GUN_HI)
    }
    // sprocket at the back, idler at the front
    m.cylX(y0 + 1.5, h - 1.5, 1.2, xo, xo, GUN_HI)
    m.cylX(y1 - 1, h - 1.5, 1.1, xo, xo, GUN)
    if (opt.skirt !== undefined) m.box(left ? xa - 1 : xb + 1, y0 + 2, opt.skirt, left ? xa - 1 : xb + 1, y1 - 2, h - 1, s.base)
  }
}

/** a pair of tyres per axle */
function axle(m: Vox, y: number, w: number, r: number, s: Scheme) {
  for (const x0 of [0, w - 2]) {
    m.cylX(y + 0.5, r, r, x0, x0 + 1, RUBBER)
    m.set(x0 === 0 ? 0 : w - 1, y, Math.round(r - 0.5), GUN_HI)
  }
  void s
}

function hatch(m: Vox, x: number, y: number, z: number, c: number) {
  m.box(x, y, z, x + 1, y + 1, z, shade(c, 0.75))
  m.set(x, y, z, shade(c, 1.2))
}

/** a whip antenna: thin as the fine grid allows, swaying back a little */
function antenna(m: Vox, x: number, y: number, z: number, h: number) {
  m.rod(x + 0.25, y + 0.25, z, x + 0.25, y - 0.5, z + h + 1.5, GUN)
  m.dot(x + 0.25, y - 0.5, z + h + 1.5, GUN_HI)
}

/** a cluster of smoke grenade dischargers, facing forward */
function smokeCups(m: Vox, x: number, y: number, z: number, n: number, c: number) {
  for (let k = 0; k < n; k++) m.set(x + k, y, z + (k % 2), c)
}

/** a tactical number in white on a side */
function plate(m: Vox, x: number, y: number, z: number, along = true) {
  // three small white digits
  for (let k = 0; k < 3; k++)
    for (let d = 0; d < 2; d++) {
      const yy = y + k * 1 + 0.25, zz = z + d * 0.5
      if ((k + d) % 3 === 2) continue
      if (along) m.dot(x + (x < m.w / 2 ? 0 : 0.5), yy, zz, COL.white)
      else m.dot(x + k + 0.25, y + (y < m.l / 2 ? 0 : 0.5), zz, COL.white)
    }
}

// ─────────────────────────────────────────────────────────── soldiers

type Kit = 'rifle' | 'at' | 'sniper'
type Pose = 'stand' | 'walk1' | 'walk2' | 'aim'

function soldier(f: Faction, kit: Kit, pose: Pose): Vox {
  const s = SCHEMES[f]
  const m = new Vox(11, 11, 16)
  const nato = f === 'nato'
  const uni = shade(s.uniform, 1.18), uni2 = shade(s.uniform2, 1.15)
  const vest = nato ? hex('59613f') : hex('6c6c46')
  const boot = nato ? hex('2a2620') : hex('3a2e22')
  // legs and boots
  const step = pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0
  for (const [x, dy] of [[3, step], [6, -step]] as [number, number][]) {
    const y = 5 + dy
    m.box(x, y, 1, x + 1, y, 5, uni2)
    m.box(x, y, 0, x + 1, y + 1, 0, boot)
    m.set(x, y, 3, shade(uni2, 0.85)) // knee pads
  }
  if (pose === 'aim') {
    // a slight crouch: knees forward
    m.box(3, 6, 2, 4, 6, 3, uni2)
  }
  // body, vest with pouches, belt
  m.box(3, 4, 6, 7, 6, 10, uni)
  m.box(3, 4, 6, 7, 6, 6, hex('2e2b24')) // belt
  m.box(3, 6, 7, 7, 6, 10, vest)
  m.box(3, 3, 8, 7, 3, 10, vest)
  m.set(4, 7, 8, shade(vest, 0.8))
  m.set(6, 7, 8, shade(vest, 0.8))
  m.set(5, 7, 9, shade(vest, 0.85))
  // backpack
  m.box(4, 2, 7, 6, 3, 10, nato ? hex('454b31') : hex('56583a'))
  m.box(4, 2, 11, 6, 2, 11, nato ? hex('3a3f29') : hex('4b4d32'))
  // team colour on the shoulders
  m.set(2, 5, 10, s.team)
  m.set(8, 5, 10, s.team)
  // head, face to the front, helmet with a rim
  m.box(4, 4, 11, 6, 6, 12, COL.skin)
  m.set(4, 6, 12, hex('3a2a20'))
  m.set(6, 6, 12, hex('3a2a20'))
  const helmet = s.helmet
  m.box(3, 3, 13, 7, 7, 13, shade(helmet, 1.1))
  m.box(4, 4, 14, 6, 6, 14, shade(helmet, 1.2))
  m.box(4, 3, 12, 6, 3, 12, helmet) // the back of the helmet
  if (nato) m.box(4, 7, 13, 6, 7, 13, shade(helmet, 0.8)) // goggles band
  else m.set(5, 7, 14, shade(helmet, 0.8))
  // arms and the weapon
  const aim = pose === 'aim'
  const armZ = aim ? 10 : 8
  if (aim) {
    m.box(2, 6, 9, 2, 8, 10, uni)
    m.box(8, 5, 9, 8, 7, 10, uni)
  } else {
    m.box(2, 4 - step, 7, 2, 5 - step, 10, uni)
    m.box(8, 4 + step, 7, 8, 5 + step, 10, uni)
  }
  const wy = aim ? 6 : 6
  if (kit === 'rifle') {
    // G36 with its carrying handle, or an AK with a curved magazine
    m.box(7, wy, armZ, 7, wy + 5, armZ, GUN)
    if (nato) {
      m.box(7, wy + 1, armZ + 1, 7, wy + 3, armZ + 1, GUN_HI)
      m.set(7, wy + 2, armZ - 1, GUN)
    } else {
      m.set(7, wy + 2, armZ - 1, hex('6a4a2a'))
      m.set(7, wy + 3, armZ - 2, hex('6a4a2a'))
      m.set(7, wy - 1, armZ, hex('6a4a2a'))
    }
  } else if (kit === 'at') {
    // the launcher on the shoulder
    const z = 11
    if (nato) {
      // Panzerfaust 3: a fat tube with a big round warhead
      m.box(7, 1, z, 8, 8, z, hex('4c5636'))
      m.box(7, 9, z - 1, 8, 10, z + 1, hex('6a7448'))
      m.set(7, 4, z + 1, GUN)
    } else {
      // RPG-7: a slim tube and the pointed warhead
      m.box(7, 1, z, 7, 8, z, hex('5a4a34'))
      m.box(7, 9, z - 1, 7, 10, z + 1, hex('5d6a3c'))
      m.set(7, 11, z, hex('5d6a3c'))
      m.set(7, 1, z, GUN)
    }
  } else {
    // a long rifle with a scope, and a ghillie cape of leaves
    m.box(7, wy - 1, armZ, 7, wy + 7, armZ, nato ? GUN : hex('5a4030'))
    m.box(7, wy + 1, armZ + 1, 7, wy + 3, armZ + 1, GUN_HI)
    m.paint((x, y, z, c) => {
      if (z < 6 || z > 14 || c === COL.skin || c === GUN || c === GUN_HI) return c
      const h = hash3(x, y, z)
      return h < 0.5 ? (h < 0.25 ? COL.leaf1 : COL.leaf2) : c
    })
    m.set(2, 3, 12, COL.leaf1)
    m.set(8, 4, 13, COL.leaf2)
  }
  // camouflage on the uniform: Flecktarn dots or a digital pattern
  m.paint((x, y, z, c) => {
    if (c !== uni && c !== uni2) return c
    const h = hash3(x * 3, y * 5, z * 7)
    if (nato) return h < 0.1 ? hex('34392a') : h < 0.24 ? hex('6a5638') : h < 0.36 ? hex('7a8752') : c
    const blk = hash3(x >> 1, y >> 1, z >> 1)
    return blk < 0.3 ? hex('62623f') : blk > 0.8 ? hex('8a8458') : c
  })
  m.px = 5.5
  m.py = 5.5
  return m
}

function infantry(f: Faction, kit: Kit): UnitModel {
  return {
    hull: soldier(f, kit, 'stand'),
    alt: soldier(f, kit, 'walk1'),
    alt2: soldier(f, kit, 'walk2'),
    aim: soldier(f, kit, 'aim'),
    muzzle: [6, 6],
  }
}

// ─────────────────────────────────────────────────────────── tanks

/** Leopard 2A6: flat hull with seven road wheels and skirts, the arrow-head turret, the long L55 gun */
function leopard(phase: number): Vox {
  const s = SCHEMES.nato
  const m = new Vox(17, 31, 9)
  tracks(m, s, { x0: 1, x1: 15, tw: 3, y0: 1, y1: 29, h: 4, wheels: 7, phase, skirt: 2 })
  m.box(2, 0, 3, 14, 30, 6, s.base)
  slope(m, 26, 6, 30, 3)
  m.box(3, 30, 3, 13, 30, 3, shade(s.base, 0.8))
  // engine deck with grilles, rear stowage
  for (let y = 2; y <= 9; y += 2) m.box(4, y, 6, 12, y, 6, s.dark)
  m.box(3, 0, 5, 13, 0, 7, GUN)
  m.box(3, 0, 7, 13, 1, 7, -1)
  // driver's hatch and periscopes, headlights
  hatch(m, 9, 25, 6, s.base)
  m.box(8, 26, 6, 10, 26, 6, s.glass)
  m.set(3, 30, 4, LIGHT, true)
  m.set(13, 30, 4, LIGHT, true)
  // tow cables and tools on the skirts
  m.box(1, 6, 6, 1, 22, 6, GUN)
  m.box(15, 6, 6, 15, 22, 6, GUN)
  m.box(2, 3, 5, 2, 5, 6, s.team)
  m.box(14, 3, 5, 14, 5, 6, s.team)
  plate(m, 1, 12, 4)
  camo(m, s, 'nato', 11)
  m.py = 15
  return m
}

function leopardTurret(): Vox {
  const s = SCHEMES.nato
  const m = new Vox(15, 36, 8)
  // the box of the turret
  m.box(1, 0, 0, 13, 12, 4, s.base)
  // the wedge armour: an arrow head in front
  for (let y = 13; y <= 17; y++) {
    const k = y - 13
    m.box(1 + k, y, 0, 13 - k, y, 4 - Math.floor(k / 2), s.base)
  }
  // bustle with stowage basket at the back
  m.box(1, 0, 0, 13, 1, 3, s.dark)
  for (let x = 1; x <= 13; x += 2) m.set(x, 0, 4, GUN)
  // commander's PERI sight, hatches, loader's MG
  m.box(3, 7, 5, 4, 8, 7, GUN)
  m.box(3, 8, 7, 4, 8, 7, s.glass)
  hatch(m, 3, 4, 5, s.base)
  hatch(m, 9, 4, 5, s.base)
  m.box(10, 6, 5, 10, 9, 5, GUN)
  m.box(11, 9, 5, 11, 10, 6, GUN) // gunner's sight
  smokeCups(m, 0, 9, 3, 1, GUN)
  smokeCups(m, 14, 9, 3, 1, GUN)
  m.box(0, 4, 2, 0, 7, 3, s.team)
  m.box(14, 4, 2, 14, 7, 3, s.team)
  antenna(m, 2, 1, 5, 2)
  antenna(m, 12, 1, 5, 2)
  // the long L55 gun with its thermal sleeve and muzzle
  m.box(6, 13, 1, 8, 15, 3, GUN)
  m.box(7, 15, 2, 7, 35, 2, GUN)
  m.box(6, 15, 2, 8, 30, 2, s.dark)
  m.box(6, 33, 1, 8, 34, 3, GUN)
  camo(m, s, 'nato', 12)
  m.px = 7.5
  m.py = 7
  return m
}

/** T-90A: low hull with Kontakt-5 blocks on the glacis, six road wheels, fuel drums; a rounded turret with a V of reactive armour and the Shtora dazzlers */
function t90(phase: number): Vox {
  const s = SCHEMES.ru
  const m = new Vox(17, 30, 8)
  tracks(m, s, { x0: 1, x1: 15, tw: 3, y0: 1, y1: 28, h: 4, wheels: 6, phase })
  m.box(2, 0, 3, 14, 29, 5, s.base)
  slope(m, 22, 5, 29, 3)
  // reactive armour bricks on the glacis
  for (let y = 23; y <= 28; y += 2) for (let x = 3; x <= 13; x += 3) m.box(x, y, 4 + Math.max(0, Math.round((28 - y) / 3) - 1), x + 1, y, 4 + Math.max(0, Math.round((28 - y) / 3) - 1), shade(s.base, 0.82))
  // side skirts with rubber flaps at the front
  m.box(1, 18, 3, 1, 27, 3, s.camo3)
  m.box(15, 18, 3, 15, 27, 3, s.camo3)
  // fuel drums at the back, the engine grille, the snorkel
  m.cylX(1.5, 6.5, 1.5, 3, 13, shade(s.base, 0.78))
  for (let y = 4; y <= 10; y += 2) m.box(5, y, 5, 11, y, 5, s.dark)
  m.box(2, 6, 5, 2, 16, 5, GUN)
  m.set(3, 29, 4, LIGHT, true)
  m.set(13, 29, 4, LIGHT, true)
  m.box(2, 3, 4, 2, 5, 5, s.team)
  m.box(14, 3, 4, 14, 5, 5, s.team)
  plate(m, 15, 10, 4)
  camo(m, s, 'ru', 13)
  m.py = 14.5
  return m
}

function t90Turret(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(15, 34, 8)
  m.ball(7, 7, 0.5, 6.6, 6.8, 4, s.base)
  m.box(0, 0, -1, 14, 14, -1, -1)
  // a V of reactive armour on the front
  for (let k = 0; k < 5; k++) {
    m.box(2 + k, 11 + Math.min(k, 2), 1, 2 + k, 12 + Math.min(k, 2), 3, shade(s.base, 0.82))
    m.box(12 - k, 11 + Math.min(k, 2), 1, 12 - k, 12 + Math.min(k, 2), 3, shade(s.base, 0.82))
  }
  // Shtora: two boxes with red lamps either side of the gun
  m.box(3, 12, 3, 4, 13, 4, GUN)
  m.set(3, 14, 3, RED_LAMP, true)
  m.box(10, 12, 3, 11, 13, 4, GUN)
  m.set(11, 14, 3, RED_LAMP, true)
  // commander's cupola with the remote MG, hatches
  m.cylZ(4.5, 5, 1.8, 4, 4, s.dark)
  m.box(5, 5, 5, 5, 9, 5, GUN)
  hatch(m, 9, 4, 4, s.base)
  smokeCups(m, 1, 6, 2, 2, GUN)
  smokeCups(m, 12, 6, 2, 2, GUN)
  m.box(0, 5, 1, 0, 7, 2, s.team)
  m.box(14, 5, 1, 14, 7, 2, s.team)
  antenna(m, 7, 1, 4, 3)
  // the 125 mm gun with its thermal sleeve and fume extractor
  m.box(6, 13, 1, 8, 14, 2, GUN)
  m.box(7, 14, 2, 7, 33, 2, GUN)
  m.box(6, 18, 1, 8, 20, 3, s.dark)
  camo(m, s, 'ru', 14)
  m.px = 7.5
  m.py = 7
  return m
}

// ─────────────────────────────────────────────────────────── infantry fighting vehicles, scouts

/** Marder 1A5: a tall box, a small offset turret with the 20 mm cannon and a MILAN launcher */
function marder(phase: number): Vox {
  const s = SCHEMES.nato
  const m = new Vox(16, 29, 10)
  tracks(m, s, { x0: 1, x1: 14, tw: 3, y0: 1, y1: 27, h: 4, wheels: 6, phase, skirt: 2 })
  m.box(2, 0, 3, 13, 28, 8, s.base)
  slope(m, 21, 8, 28, 3)
  // rear ramp, firing ports, headlights
  m.box(4, 0, 3, 11, 0, 7, s.dark)
  for (let y = 6; y <= 16; y += 5) {
    m.set(1, y, 6, s.glass)
    m.set(14, y, 6, s.glass)
  }
  m.box(11, 22, 8, 12, 23, 8, GUN) // driver's hatch
  m.set(3, 28, 4, LIGHT, true)
  m.set(12, 28, 4, LIGHT, true)
  for (let y = 3; y <= 9; y += 2) m.box(4, y, 8, 11, y, 8, s.dark)
  m.box(2, 2, 7, 2, 4, 8, s.team)
  m.box(13, 2, 7, 13, 4, 8, s.team)
  plate(m, 1, 9, 5)
  antenna(m, 3, 2, 9, 0)
  camo(m, s, 'nato', 31)
  m.py = 14
  return m
}

function marderTurret(): Vox {
  const s = SCHEMES.nato
  const m = new Vox(10, 20, 6)
  m.box(1, 1, 0, 8, 8, 3, s.base)
  m.box(1, 8, 3, 8, 8, 3, -1)
  m.box(4, 8, 1, 5, 9, 2, GUN)
  m.box(4, 9, 2, 4, 19, 2, GUN) // 20 mm cannon
  m.box(9, 3, 3, 9, 9, 4, hex('5d6845')) // MILAN on the side
  m.set(9, 10, 4, hex('6a7448'))
  hatch(m, 2, 3, 4, s.base)
  smokeCups(m, 0, 6, 2, 1, GUN)
  m.box(1, 4, 1, 1, 6, 2, s.team)
  camo(m, s, 'nato', 32)
  m.px = 4.5
  m.py = 4.5
  return m
}

/** BMP-2: low and long with a ribbed, sharply sloped nose; the turret in the middle with a long 30 mm gun and a Konkurs launcher */
function bmp(phase: number): Vox {
  const s = SCHEMES.ru
  const m = new Vox(16, 28, 8)
  tracks(m, s, { x0: 1, x1: 14, tw: 3, y0: 1, y1: 26, h: 4, wheels: 6, phase })
  m.box(2, 0, 3, 13, 27, 6, s.base)
  slope(m, 13, 6, 27, 3)
  for (let y = 15; y <= 26; y += 2) m.box(3, y, Math.max(3, Math.round(6 - (y - 13) * 0.21)), 12, y, Math.max(3, Math.round(6 - (y - 13) * 0.21)), shade(s.base, 0.84))
  // rear doors (which are fuel tanks), roof hatches, periscopes
  m.box(4, 0, 3, 6, 0, 5, s.dark)
  m.box(9, 0, 3, 11, 0, 5, s.dark)
  for (let y = 3; y <= 8; y += 3) {
    hatch(m, 3, y, 6, s.base)
    hatch(m, 11, y, 6, s.base)
  }
  m.set(3, 27, 3, LIGHT, true)
  m.set(12, 27, 3, LIGHT, true)
  m.box(2, 12, 5, 2, 14, 6, s.team)
  m.box(13, 12, 5, 13, 14, 6, s.team)
  plate(m, 1, 8, 4)
  camo(m, s, 'ru', 33)
  m.py = 13
  return m
}

function bmpTurret(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(10, 22, 7)
  m.ball(5, 5, 0.4, 4.4, 4.4, 3, s.base)
  m.box(0, 0, -1, 9, 9, -1, -1)
  m.box(4, 8, 1, 5, 9, 2, GUN)
  m.box(5, 9, 2, 5, 21, 2, GUN) // the 2A42 with its muzzle
  m.box(4, 19, 1, 6, 20, 3, GUN)
  m.box(2, 2, 4, 6, 3, 4, hex('6a7448')) // Konkurs tube on the roof
  m.box(2, 3, 4, 2, 9, 4, hex('6a7448'))
  smokeCups(m, 0, 4, 1, 2, GUN)
  smokeCups(m, 8, 4, 1, 2, GUN)
  m.box(0, 5, 1, 0, 6, 1, s.team)
  camo(m, s, 'ru', 34)
  m.px = 5
  m.py = 5
  return m
}

/** Fennek: a low four-wheeled scout with its sensor head on a mast */
function fennek(): Vox {
  const s = SCHEMES.nato
  const m = new Vox(13, 24, 14)
  axle(m, 5, 13, 2, s)
  axle(m, 18, 13, 2, s)
  m.box(1, 1, 2, 11, 22, 5, s.base)
  slope(m, 17, 5, 22, 2)
  m.box(2, 4, 6, 10, 15, 7, s.base)
  m.box(2, 15, 6, 10, 15, 7, s.glass)
  m.box(1, 12, 6, 1, 14, 7, s.glass)
  m.box(11, 12, 6, 11, 14, 7, s.glass)
  // the sensor mast: a pole with a head of optics
  m.box(6, 6, 8, 6, 6, 11, GUN)
  m.box(5, 5, 12, 7, 7, 13, GUN)
  m.set(6, 8, 12, s.glass, true)
  m.set(2, 22, 3, LIGHT, true)
  m.set(10, 22, 3, LIGHT, true)
  m.box(1, 2, 5, 2, 3, 5, s.team)
  antenna(m, 9, 4, 8, 3)
  camo(m, s, 'nato', 71)
  m.py = 11.5
  return m
}
function fennekTurret(): Vox {
  const m = new Vox(5, 10, 3)
  m.box(1, 0, 0, 3, 3, 1, GUN)
  m.box(2, 3, 1, 2, 9, 1, GUN)
  m.px = 2.5
  m.py = 2
  return m
}

/** BRDM-2: a boat-shaped body on four wheels, a small cone turret with a heavy MG */
function brdm(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(13, 25, 9)
  axle(m, 5, 13, 2, s)
  axle(m, 18, 13, 2, s)
  m.box(1, 1, 2, 11, 23, 6, s.base)
  slope(m, 17, 6, 24, 2)
  m.box(1, 24, 2, 11, 24, 3, s.base)
  m.box(3, 18, 5, 9, 18, 5, s.glass)
  m.box(1, 0, 2, 11, 0, 4, s.dark)
  m.set(2, 24, 3, LIGHT, true)
  m.set(10, 24, 3, LIGHT, true)
  m.box(1, 9, 5, 1, 12, 5, s.team)
  m.box(11, 9, 5, 11, 12, 5, s.team)
  antenna(m, 2, 3, 7, 1)
  camo(m, s, 'ru', 72)
  m.py = 12
  return m
}
function brdmTurret(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(7, 13, 4)
  m.cylZ(3.5, 3.5, 3, 0, 1, s.base)
  m.cylZ(3.5, 3.5, 2.2, 2, 2, s.base)
  m.box(3, 5, 1, 3, 12, 1, GUN)
  m.px = 3.5
  m.py = 3.5
  camo(m, s, 'ru', 73)
  return m
}

// ─────────────────────────────────────────────────────────── flak tanks

/** Gepard: the Leopard 1 hull, a big turret with a 35 mm cannon on each side, the search radar on the back (it turns) and the tracking radar in front */
function gepard(phase: number): Vox {
  const s = SCHEMES.nato
  const m = new Vox(16, 30, 8)
  tracks(m, s, { x0: 1, x1: 14, tw: 3, y0: 1, y1: 28, h: 4, wheels: 7, phase, skirt: 2 })
  m.box(2, 0, 3, 13, 29, 6, s.base)
  slope(m, 24, 6, 29, 3)
  for (let y = 2; y <= 8; y += 2) m.box(4, y, 6, 11, y, 6, s.dark)
  m.set(3, 29, 4, LIGHT, true)
  m.set(12, 29, 4, LIGHT, true)
  m.box(2, 3, 5, 2, 5, 6, s.team)
  m.box(13, 3, 5, 13, 5, 6, s.team)
  plate(m, 1, 12, 4)
  camo(m, s, 'nato', 51)
  m.py = 14.5
  return m
}

function gepardTurret(angle: number): Vox {
  const s = SCHEMES.nato
  const m = new Vox(19, 26, 16)
  m.box(4, 2, 0, 14, 13, 6, s.base)
  m.box(4, 13, 4, 14, 13, 6, -1)
  // the guns in their side mounts
  for (const x0 of [0, 16]) {
    m.box(x0, 5, 2, x0 + 2, 12, 5, s.dark)
    m.box(x0 + 1, 12, 3, x0 + 1, 24, 3, GUN)
    m.box(x0, 22, 2, x0 + 2, 23, 4, GUN)
  }
  // tracking radar dish in front
  m.ball(9, 14.5, 4, 2.4, 1, 2.4, GUN_HI)
  m.set(9, 15, 4, GUN)
  // search radar on its post at the back, turning
  m.box(8, 2, 7, 10, 4, 8, GUN)
  m.box(9, 3, 9, 9, 3, 10, GUN)
  const ca = Math.cos(angle), sa = Math.sin(angle)
  for (let k = -5; k <= 5; k++)
    for (let h = 0; h <= 2; h++) m.set(Math.round(9 + ca * k), Math.round(3 + sa * k), 11 + h, h === 1 ? GUN_HI : GUN)
  hatch(m, 5, 6, 7, s.base)
  hatch(m, 12, 6, 7, s.base)
  m.box(4, 8, 2, 4, 10, 3, s.team)
  m.box(14, 8, 2, 14, 10, 3, s.team)
  camo(m, s, 'nato', 52)
  m.px = 9.5
  m.py = 7.5
  return m
}

/** 2K22 Tunguska: guns and missiles on either side of the turret and a turning radar on the back */
function tunguska(phase: number): Vox {
  const s = SCHEMES.ru
  const m = new Vox(16, 30, 8)
  tracks(m, s, { x0: 1, x1: 14, tw: 3, y0: 1, y1: 28, h: 4, wheels: 6, phase })
  m.box(2, 0, 3, 13, 29, 6, s.base)
  slope(m, 23, 6, 29, 3)
  m.box(1, 6, 3, 1, 22, 3, s.camo3)
  m.box(14, 6, 3, 14, 22, 3, s.camo3)
  m.set(3, 29, 4, LIGHT, true)
  m.set(12, 29, 4, LIGHT, true)
  m.box(2, 3, 5, 2, 5, 6, s.team)
  m.box(13, 3, 5, 13, 5, 6, s.team)
  plate(m, 14, 12, 4)
  camo(m, s, 'ru', 53)
  m.py = 14.5
  return m
}

function tunguskaTurret(angle: number): Vox {
  const s = SCHEMES.ru
  const m = new Vox(21, 24, 16)
  m.box(5, 1, 0, 15, 12, 6, s.base)
  m.box(5, 12, 4, 15, 12, 6, -1)
  for (const left of [true, false]) {
    const x0 = left ? 0 : 17
    // four missile tubes in a block
    m.box(x0, 3, 3, x0 + 3, 10, 6, s.camo2)
    for (let x = x0; x <= x0 + 3; x += 2) for (let z = 3; z <= 6; z += 2) m.set(x, 10, z, s.track)
    // twin guns below
    m.box(left ? 4 : 16, 6, 2, left ? 4 : 16, 20, 2, GUN)
    m.box(left ? 4 : 16, 6, 1, left ? 4 : 16, 18, 1, GUN)
  }
  // tracking radar in front, search radar on top at the back, turning
  m.ball(10, 13, 4, 2, 1, 2, GUN_HI)
  m.box(9, 2, 7, 11, 4, 9, GUN)
  const ca = Math.cos(angle), sa = Math.sin(angle)
  for (let k = -6; k <= 6; k++)
    for (let h = 0; h <= 1; h++) m.set(Math.round(10 + ca * k), Math.round(3 + sa * k), 10 + h + (Math.abs(k) > 4 ? 1 : 0), h ? GUN_HI : GUN)
  hatch(m, 6, 6, 7, s.base)
  m.box(5, 7, 2, 5, 9, 3, s.team)
  m.box(15, 7, 2, 15, 9, 3, s.team)
  camo(m, s, 'ru', 54)
  m.px = 10.5
  m.py = 6.5
  return m
}

// ─────────────────────────────────────────────────────────── artillery

/** Panzerhaubitze 2000: a long hull, a huge turret at the back and the 52-calibre barrel */
function pzh(phase: number): Vox {
  const s = SCHEMES.nato
  const m = new Vox(17, 32, 8)
  tracks(m, s, { x0: 1, x1: 15, tw: 3, y0: 1, y1: 30, h: 4, wheels: 7, phase, skirt: 2 })
  m.box(2, 0, 3, 14, 31, 5, s.base)
  slope(m, 26, 5, 31, 3)
  // barrel travel lock on the nose, driver's hatch, headlights
  m.box(8, 28, 6, 8, 28, 7, GUN)
  m.box(7, 28, 7, 9, 28, 7, GUN)
  hatch(m, 3, 26, 5, s.base)
  m.set(3, 31, 4, LIGHT, true)
  m.set(13, 31, 4, LIGHT, true)
  m.box(2, 2, 4, 2, 4, 5, s.team)
  m.box(14, 2, 4, 14, 4, 5, s.team)
  plate(m, 1, 18, 4)
  camo(m, s, 'nato', 41)
  m.py = 15.5
  return m
}
function pzhTurret(): Vox {
  const s = SCHEMES.nato
  const m = new Vox(16, 42, 10)
  m.box(1, 0, 0, 14, 16, 7, s.base)
  m.box(1, 16, 6, 14, 16, 7, -1)
  m.box(1, 0, 7, 2, 16, 7, -1)
  m.box(13, 0, 7, 14, 16, 7, -1)
  // the 155 mm barrel with fume extractor and multi-baffle muzzle brake
  m.box(6, 16, 2, 9, 18, 5, s.dark)
  m.box(7, 18, 3, 8, 41, 4, GUN)
  m.box(6, 24, 3, 9, 26, 4, GUN)
  m.box(6, 38, 2, 9, 41, 5, GUN)
  // hatches, MG ring, smoke cups, stowage boxes
  hatch(m, 3, 4, 8, s.base)
  hatch(m, 10, 4, 8, s.base)
  m.box(3, 8, 8, 4, 9, 8, GUN)
  smokeCups(m, 1, 15, 5, 3, GUN)
  smokeCups(m, 12, 15, 5, 3, GUN)
  m.box(0, 3, 1, 0, 12, 4, s.dark)
  m.box(15, 3, 1, 15, 12, 4, s.dark)
  m.box(0, 6, 5, 0, 9, 5, s.team)
  m.box(15, 6, 5, 15, 9, 5, s.team)
  antenna(m, 2, 1, 8, 2)
  camo(m, s, 'nato', 42)
  m.px = 8
  m.py = 7
  return m
}

/** 2S19 Msta-S */
function msta(phase: number): Vox {
  const s = SCHEMES.ru
  const m = new Vox(17, 31, 8)
  tracks(m, s, { x0: 1, x1: 15, tw: 3, y0: 1, y1: 29, h: 4, wheels: 6, phase })
  m.box(2, 0, 3, 14, 30, 5, s.base)
  slope(m, 25, 5, 30, 3)
  m.box(1, 4, 3, 1, 25, 3, s.camo3)
  m.box(15, 4, 3, 15, 25, 3, s.camo3)
  m.cylX(1.5, 6.5, 1.4, 3, 13, shade(s.base, 0.78))
  m.set(3, 30, 4, LIGHT, true)
  m.set(13, 30, 4, LIGHT, true)
  m.box(2, 3, 4, 2, 5, 5, s.team)
  m.box(14, 3, 4, 14, 5, 5, s.team)
  plate(m, 15, 14, 4)
  camo(m, s, 'ru', 45)
  m.py = 15
  return m
}
function mstaTurret(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(16, 40, 10)
  m.box(0, 0, 0, 15, 16, 6, s.base)
  m.box(0, 16, 6, 15, 16, 6, -1)
  m.box(0, 0, 6, 1, 16, 6, -1)
  m.box(14, 0, 6, 15, 16, 6, -1)
  m.box(2, 1, 7, 5, 4, 8, s.dark) // commander's cupola
  m.box(11, 2, 7, 12, 6, 7, GUN) // remote MG
  m.box(6, 16, 1, 9, 18, 5, s.dark)
  m.box(7, 18, 3, 8, 39, 4, GUN)
  m.box(6, 24, 2, 9, 26, 5, GUN) // fume extractor
  m.box(6, 36, 2, 9, 38, 5, GUN) // muzzle brake
  smokeCups(m, 0, 14, 4, 3, GUN)
  smokeCups(m, 13, 14, 4, 3, GUN)
  m.box(0, 5, 2, 0, 10, 4, s.team)
  m.box(15, 5, 2, 15, 10, 4, s.team)
  antenna(m, 14, 1, 7, 3)
  camo(m, s, 'ru', 46)
  m.px = 8
  m.py = 7
  return m
}

/** MARS II: the Bradley chassis, a crew cab in front and two rocket pods at the back */
function mars(phase: number): Vox {
  const s = SCHEMES.nato
  const m = new Vox(17, 32, 12)
  tracks(m, s, { x0: 1, x1: 15, tw: 3, y0: 1, y1: 30, h: 4, wheels: 6, phase, skirt: 2 })
  m.box(2, 0, 3, 14, 31, 4, s.base)
  m.box(2, 22, 5, 14, 31, 10, s.base) // the armoured cab
  slope(m, 28, 10, 31, 6)
  m.box(3, 31, 6, 13, 31, 7, s.glass)
  m.box(1, 25, 8, 1, 28, 9, s.glass)
  m.box(15, 25, 8, 15, 28, 9, s.glass)
  m.box(2, 1, 5, 14, 20, 5, s.dark) // launcher bed
  m.set(3, 31, 4, LIGHT, true)
  m.set(13, 31, 4, LIGHT, true)
  m.box(5, 24, 11, 11, 26, 11, s.team)
  antenna(m, 3, 23, 11, 0)
  plate(m, 1, 24, 6)
  camo(m, s, 'nato', 47)
  m.py = 15.5
  return m
}
function marsTurret(): Vox {
  const s = SCHEMES.nato
  const m = new Vox(15, 20, 8)
  m.box(0, 0, 0, 14, 17, 6, s.base)
  m.box(7, 0, 0, 7, 17, 6, s.dark)
  // the ends of the rocket tubes in two pods
  for (const x0 of [1, 9]) for (let x = x0; x <= x0 + 4; x += 2) for (let z = 1; z <= 5; z += 2) m.set(x, 17, z, s.track)
  m.box(0, 0, 7, 14, 2, 7, GUN)
  m.box(0, 6, 3, 0, 10, 4, s.team)
  m.box(14, 6, 3, 14, 10, 4, s.team)
  camo(m, s, 'nato', 48)
  m.px = 7.5
  m.py = 8
  return m
}

/** BM-21 Grad on the Ural-375 truck: six wheels, the rounded cab, forty tubes */
function grad(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(14, 31, 12)
  for (const y of [5, 10, 25]) axle(m, y, 14, 2.2, s)
  m.box(2, 1, 2, 11, 30, 3, s.dark) // the frame
  // the cab with its rounded wings
  m.box(2, 22, 4, 11, 28, 9, s.base)
  m.box(1, 26, 3, 3, 30, 5, s.base)
  m.box(10, 26, 3, 12, 30, 5, s.base)
  m.box(4, 29, 4, 9, 30, 5, s.base) // bonnet
  m.box(3, 28, 7, 10, 28, 8, s.glass)
  m.box(2, 24, 7, 2, 26, 8, s.glass)
  m.box(11, 24, 7, 11, 26, 8, s.glass)
  m.box(3, 22, 10, 10, 26, 10, s.camo3) // canvas roof
  m.set(2, 30, 4, LIGHT, true)
  m.set(11, 30, 4, LIGHT, true)
  m.box(2, 1, 4, 11, 19, 4, s.base)
  m.box(5, 23, 10, 8, 24, 10, s.team)
  camo(m, s, 'ru', 43)
  m.py = 15
  return m
}
function gradTurret(): Vox {
  const s = SCHEMES.ru
  const m = new Vox(13, 17, 8)
  m.box(1, 0, 0, 11, 15, 6, s.base)
  // forty tube ends: four rows of ten
  for (let x = 1; x <= 11; x++) for (let z = 0; z <= 6; z++) if (z % 2 === 1 || x % 2 === 0) m.set(x, 15, z, z % 2 === 1 && x % 2 === 1 ? s.track : shade(s.base, 0.75))
  m.box(5, 2, 0, 7, 4, 0, GUN)
  m.box(0, 4, 2, 0, 9, 3, s.team)
  m.box(12, 4, 2, 12, 9, 3, s.team)
  camo(m, s, 'ru', 44)
  m.px = 6
  m.py = 7
  return m
}

// ─────────────────────────────────────────────────────────── trucks

/** the ore truck: a MAN with its flat front, a KAMAZ with its rounded one */
function oreTruck(f: Faction, loaded: boolean): Vox {
  const s = SCHEMES[f]
  const m = new Vox(14, 29, 14)
  for (const y of [5, 10, 23]) axle(m, y, 14, 2.2, s)
  m.box(2, 1, 2, 11, 28, 3, s.dark)
  const cab = COL.hazard
  if (f === 'nato') {
    m.box(1, 21, 4, 12, 28, 11, cab)
    m.box(2, 28, 7, 11, 28, 10, s.glass)
    m.box(2, 28, 4, 11, 28, 5, GUN) // grille
  } else {
    m.box(1, 21, 4, 12, 26, 11, cab)
    m.box(2, 26, 4, 11, 28, 7, cab) // the nose
    m.box(1, 27, 3, 12, 28, 4, shade(cab, 0.8))
    m.box(2, 26, 8, 11, 26, 10, s.glass)
  }
  m.box(1, 23, 8, 1, 25, 10, s.glass)
  m.box(12, 23, 8, 12, 25, 10, s.glass)
  m.box(3, 21, 12, 10, 24, 12, s.team)
  m.set(2, 28, 5, LIGHT, true)
  m.set(11, 28, 5, LIGHT, true)
  m.box(12, 20, 5, 12, 20, 12, GUN) // exhaust stack
  // the tipper body with ribs
  const body = shade(COL.hazard, 0.88)
  m.box(1, 1, 4, 12, 19, 4, body)
  m.box(1, 1, 5, 1, 19, 10, body)
  m.box(12, 1, 5, 12, 19, 10, body)
  m.box(1, 1, 5, 12, 1, 10, shade(body, 0.9))
  m.box(1, 19, 5, 12, 19, 11, shade(body, 0.9))
  for (let y = 3; y <= 17; y += 4) {
    m.box(0, y, 5, 0, y, 10, shade(body, 0.75))
    m.box(13, y, 5, 13, y, 10, shade(body, 0.75))
  }
  if (loaded) {
    for (let y = 2; y <= 18; y++)
      for (let x = 2; x <= 11; x++) {
        const h = 10 + Math.round(2.5 - Math.abs(y - 10) * 0.25 - Math.abs(x - 6.5) * 0.35 + hash3(x, y, 1))
        const r = hash3(x, y, 2)
        m.box(x, y, 5, x, y, h, r < 0.3 ? COL.ore2 : r < 0.55 ? COL.ore3 : COL.ore)
      }
  }
  m.py = 14
  return m
}

// ─────────────────────────────────────────────────────────── helicopters and jets

/** AH-64 Apache: tandem cockpit, chin sensor turret, stub wings with Hellfires, the Longbow dome over the rotor */
function apache(): UnitModel {
  const s = SCHEMES.nato
  const c = hex('4a5236')
  const m = new Vox(20, 38, 14)
  m.box(8, 8, 2, 11, 27, 6, c) // fuselage
  m.box(9, 28, 2, 10, 32, 5, c)
  m.box(9, 33, 2, 10, 33, 3, GUN) // nose sensors
  m.box(8, 30, 1, 11, 31, 1, GUN) // chin turret
  m.box(9, 32, 1, 9, 34, 1, GUN) // the 30 mm chain gun
  // the stepped tandem canopy
  m.box(9, 28, 6, 10, 31, 7, s.glass)
  m.box(9, 23, 7, 10, 27, 8, s.glass)
  m.box(9, 27, 7, 10, 27, 8, c)
  // engines either side
  m.cylY(7, 7, 1.6, 13, 20, GUN_HI)
  m.cylY(12.5, 7, 1.6, 13, 20, GUN_HI)
  m.set(7, 12, 7, GUN)
  m.set(12, 12, 7, GUN)
  // mast with the Longbow radar dome
  m.box(9, 17, 8, 10, 18, 11, GUN)
  m.ball(9.5, 17.5, 12.5, 2, 2, 1.2, GUN_HI)
  // tail boom, fin, tailplane, tail wheel
  m.box(9, 0, 5, 10, 8, 6, c)
  m.box(9, 0, 7, 10, 3, 11, c)
  m.box(6, 1, 5, 13, 2, 5, c)
  m.set(9, 1, 3, RUBBER)
  m.set(11, 1, 9, GUN_HI)
  // stub wings with four Hellfires and a rocket pod each side
  m.box(2, 17, 5, 17, 19, 5, c)
  for (const x of [2, 4, 15, 17]) m.box(x, 16, 3, x, 21, 4, GUN_HI)
  m.box(6, 16, 3, 7, 21, 4, GUN)
  m.box(12, 16, 3, 13, 21, 4, GUN)
  // landing gear
  m.box(7, 25, 0, 7, 25, 1, RUBBER)
  m.box(12, 25, 0, 12, 25, 1, RUBBER)
  m.box(8, 12, 6, 8, 13, 6, s.team)
  m.box(11, 12, 6, 11, 13, 6, s.team)
  m.set(9, 4, 6, COL.white)
  m.px = 9.5
  m.py = 18
  return { hull: m, rotor: { r: 20, z: 12, tail: 16 }, muzzle: [14, 2] }
}

/** Mi-24 Hind: a big body, the double bubble canopy, troop windows, anhedral stub wings with pods */
function hind(): UnitModel {
  const s = SCHEMES.ru
  const c = hex('6a7046')
  const c2 = hex('8a8458')
  const m = new Vox(24, 42, 15)
  m.box(8, 8, 2, 15, 30, 9, c) // the cabin
  m.box(9, 31, 2, 14, 36, 6, c)
  m.box(10, 37, 2, 13, 37, 4, s.glass) // gunner's bubble
  m.box(9, 33, 6, 14, 35, 7, s.glass)
  m.box(10, 30, 9, 13, 31, 10, s.glass) // pilot's bubble
  m.box(10, 37, 1, 11, 38, 1, GUN) // the nose gun
  for (let y = 12; y <= 24; y += 4) {
    m.set(7, y, 6, s.glass)
    m.set(16, y, 6, s.glass)
  }
  m.box(8, 16, 10, 15, 26, 11, c2) // engines
  m.box(8, 16, 12, 15, 17, 12, GUN) // intakes
  m.box(11, 20, 12, 12, 21, 13, GUN)
  m.box(11, 0, 6, 12, 8, 8, c) // tail boom
  m.box(11, 0, 9, 12, 3, 14, c)
  m.box(13, 1, 12, 13, 1, 12, GUN_HI)
  // wings bending down to the pods
  for (const [x, z] of [[1, 6], [3, 6], [4, 7], [5, 7], [6, 7], [17, 7], [18, 7], [19, 7], [20, 6], [22, 6]] as [number, number][]) m.box(x, 18, z, x, 21, z, c2)
  m.box(0, 17, 4, 2, 23, 5, GUN_HI)
  m.box(21, 17, 4, 23, 23, 5, GUN_HI)
  m.box(4, 18, 5, 5, 22, 6, GUN)
  m.box(18, 18, 5, 19, 22, 6, GUN)
  m.box(9, 28, 0, 9, 28, 1, RUBBER)
  m.box(14, 28, 0, 14, 28, 1, RUBBER)
  m.box(11, 10, 0, 12, 10, 1, RUBBER)
  m.paint((x, y, z, cc) => (cc === c && valueNoise(x, y + z, 4, 63) > 0.62 ? c2 : cc))
  m.box(8, 14, 9, 8, 16, 9, s.team)
  m.box(15, 14, 9, 15, 16, 9, s.team)
  m.px = 11.5
  m.py = 20
  return { hull: m, rotor: { r: 22, z: 13, tail: 18 }, muzzle: [16, 2] }
}

/** Eurofighter: delta wing, canards, one fin */
function eurofighter(): Vox {
  const s = SCHEMES.nato
  const c = s.jet, c2 = s.jet2
  const m = new Vox(24, 34, 9)
  m.box(11, 3, 2, 12, 28, 3, c)
  m.box(10, 6, 2, 13, 18, 2, c2) // the chin intake and belly
  m.box(11, 29, 2, 12, 31, 2, c)
  m.set(11, 32, 2, GUN_HI)
  m.box(11, 21, 4, 12, 26, 4, s.glass)
  m.box(11, 22, 5, 12, 24, 5, s.glass)
  // delta wings from the middle to the back
  for (let y = 3; y <= 18; y++) {
    const span = Math.round((18 - y) * 0.68) + 1
    m.box(11 - span, y, 2, 12 + span, y, 2, y < 6 ? c2 : c)
  }
  // canards
  m.box(8, 25, 3, 15, 26, 3, c)
  // one fin
  for (let z = 4; z <= 8; z++) m.box(11, 2 + (z - 4), z, 12, 7 - Math.floor((z - 4) / 2), z, c)
  m.set(11, 5, 8, s.team)
  m.box(11, 0, 2, 12, 2, 3, GUN) // the nozzles
  for (const x of [3, 6, 17, 20]) m.box(x, 9, 1, x, 12, 1, GUN_HI) // missiles
  m.set(2, 6, 2, s.team)
  m.set(21, 6, 2, s.team)
  m.px = 11.5
  m.py = 16
  return m
}

/** Su-34: the flat "platypus" nose, side-by-side cockpit, canards, two fins and two engines */
function su34(): Vox {
  const s = SCHEMES.ru
  const c = s.jet2, c2 = s.jet
  const m = new Vox(28, 38, 10)
  m.box(11, 4, 2, 16, 26, 4, c) // a wide body
  m.box(12, 27, 2, 15, 33, 3, c) // the flat nose
  m.box(13, 34, 2, 14, 35, 2, c2)
  m.box(12, 26, 4, 15, 29, 5, s.glass) // side by side
  m.box(9, 6, 2, 10, 18, 3, c2) // engines
  m.box(17, 6, 2, 18, 18, 3, c2)
  m.box(9, 2, 2, 10, 5, 3, GUN)
  m.box(17, 2, 2, 18, 5, 3, GUN)
  for (let y = 6; y <= 20; y++) {
    const span = Math.round((20 - y) * 0.75) + 2
    m.box(13 - span, y, 3, 14 + span, y, 3, y % 4 === 0 ? c2 : c)
  }
  m.box(9, 23, 3, 18, 24, 3, c) // canards
  for (const x of [10, 17]) for (let z = 4; z <= 9; z++) m.box(x, 3 + Math.floor((z - 4) / 2), z, x, 7 - Math.floor((z - 4) / 3), z, c)
  m.set(10, 5, 9, s.team)
  m.set(17, 5, 9, s.team)
  m.box(1, 10, 2, 2, 14, 2, GUN_HI) // bombs under the wings
  m.box(25, 10, 2, 26, 14, 2, GUN_HI)
  m.px = 13.5
  m.py = 18
  return m
}

// ─────────────────────────────────────────────────────────── ships

/** a hull with a pointed bow, a flared sheer and a dark waterline */
function shipHull(m: Vox, w: number, l: number, h: number, bow: number, c: number, dark: number, stern = 0) {
  const cx = (w - 1) / 2
  for (let y = 0; y < l; y++) {
    const k = y > l - 1 - bow ? (l - 1 - y) / bow : y < stern ? 0.75 + 0.25 * (y / stern) : 1
    const half = Math.max(0.5, (w / 2) * Math.sqrt(k))
    for (let x = 0; x < w; x++) {
      if (Math.abs(x - cx) > half) continue
      for (let z = 0; z < h; z++) m.set(x, y, z, z === 0 ? dark : z === 1 ? shade(dark, 1.15) : c)
    }
  }
  for (let y = l - bow; y < l; y++) for (let x = 0; x < w; x++) if (m.get(x, y, h - 1)) m.set(x, y, h, c)
}

/** a white railing round the edge of a deck at height z */
function railing(m: Vox, z: number, y0: number, y1: number) {
  for (let y = y0; y <= y1; y++)
    for (let x = 0; x < m.w; x++) {
      if (!m.get(x, y, z - 1)) continue
      const edge = !m.get(x - 1, y, z - 1) || !m.get(x + 1, y, z - 1)
      if (!edge) continue
      // posts and a top rail, one fine voxel thick
      const ox = !m.get(x - 1, y, z - 1) ? 0 : 0.5
      if (y % 2 === 0) m.rod(x + ox, y, z, x + ox, y, z + 0.6, hex('d8dcd8'))
      m.dot(x + ox, y, z + 0.6, hex('d8dcd8'))
      m.dot(x + ox, y + 0.5, z + 0.6, hex('d8dcd8'))
    }
}

/** a mast whose radar bar points at an angle */
function radarMast(m: Vox, x: number, y: number, z0: number, z1: number, angle: number, len: number) {
  m.box(x, y, z0, x, y, z1, GUN)
  const ca = Math.cos(angle), sa = Math.sin(angle)
  for (let k = -len; k <= len; k++) m.set(Math.round(x + ca * k), Math.round(y + sa * k), z1 + 1, k === 0 ? GUN : GUN_HI)
}

/** a lifeboat canister */
function raft(m: Vox, x: number, y: number, z: number) {
  m.box(x, y, z, x, y + 1, z, hex('e8e4d8'))
}

/** a naval gun turret */
function navalGun(len: number, c: number): Vox {
  const t = new Vox(7, len + 7, 5)
  t.box(0, 0, 0, 6, 6, 2, c)
  t.box(1, 6, 0, 5, 6, 1, c)
  t.box(3, 6, 1, 3, len + 6, 1, GUN)
  t.px = 3.5
  t.py = 3.5
  return t
}

/** Schnellboot S143 / Raptor */
function patrolBoat(f: Faction): UnitModel {
  const s = SCHEMES[f]
  const nato = f === 'nato'
  const L = nato ? 32 : 26, W = nato ? 10 : 9
  const m = new Vox(W, L, 12)
  shipHull(m, W, L, 3, nato ? 10 : 9, s.navy, s.navy2)
  m.box(1, 1, 3, W - 2, L - 8, 3, s.deck)
  if (nato) {
    m.box(2, 12, 4, 7, 20, 7, s.navy)
    m.box(2, 20, 6, 7, 20, 7, s.glass)
    radarMast(m, 5, 15, 8, 10, 0, 2)
    // Exocet boxes aft, angled
    for (const x of [1, 6]) m.box(x, 3, 4, x + 2, 9, 5, s.navy2)
    m.box(2, 2, 6, 7, 2, 6, s.team)
  } else {
    m.box(2, 9, 4, 6, 17, 7, s.navy)
    m.box(2, 17, 6, 6, 17, 7, s.glass)
    antenna(m, 4, 12, 8, 3)
    m.box(3, 2, 4, 5, 4, 4, s.navy2)
    m.box(3, 12, 8, 5, 13, 8, s.team)
  }
  railing(m, 4, 1, L - 6)
  m.py = L / 2
  const t = navalGun(nato ? 7 : 6, s.navy2)
  return { hull: m, turret: t, mount: [0, nato ? 9 : 7, 4], muzzle: [8, 1] }
}

/** Korvette K130 / Steregushchiy: stealthy angled superstructure, a gun forward, a hangar and deck aft */
function corvetteShip(f: Faction, angle: number): Vox {
  const s = SCHEMES[f]
  const nato = f === 'nato'
  const W = 13, L = 44
  const m = new Vox(W, L, 18)
  shipHull(m, W, L, 5, 13, s.navy, s.navy2, 6)
  m.box(1, 0, 5, W - 2, 30, 5, s.deck)
  // superstructure with slanted sides
  for (let z = 6; z <= 11; z++) {
    const k = Math.floor((z - 6) / 2)
    m.box(2 + k, 8, z, W - 3 - k, 26 - k, z, s.navy)
  }
  m.box(4, 25, 9, W - 5, 25, 10, s.glass)
  // hangar and helicopter deck aft
  m.box(2, 1, 6, W - 3, 2, 6, s.navy2)
  m.set(6, 3, 5, COL.white)
  m.set(5, 4, 5, COL.white)
  m.set(7, 4, 5, COL.white)
  // the integrated mast and its radar
  m.box(5, 16, 12, 7, 19, 14, s.navy2)
  radarMast(m, 6, 17, 15, 16, angle, 3)
  // missiles amidships, lifeboats
  if (nato) for (const x of [3, 8]) m.box(x, 5, 6, x + 1, 7, 7, s.navy2)
  else for (let x = 3; x <= 8; x += 2) m.box(x, 27, 6, x, 29, 6, s.track)
  raft(m, 1, 12, 6)
  raft(m, W - 2, 12, 6)
  railing(m, 6, 1, 30)
  m.box(2, 10, 11, 2, 12, 11, s.team)
  m.box(W - 3, 10, 11, W - 3, 12, 11, s.team)
  m.py = L / 2
  return m
}

/** Arleigh Burke: angled superstructure with the eight-sided radar panels, two funnels, a mast, cells fore and aft */
function burke(angle: number): Vox {
  const s = SCHEMES.nato
  const W = 16, L = 60
  const m = new Vox(W, L, 26)
  shipHull(m, W, L, 6, 18, s.navy, s.navy2, 8)
  m.box(1, 0, 6, W - 2, 42, 6, s.deck)
  // forward superstructure, sloping walls, the radar panels on the corners
  for (let z = 7; z <= 14; z++) {
    const k = Math.floor((z - 7) / 3)
    m.box(2 + k, 27, z, W - 3 - k, 39 - k, z, s.navy)
  }
  for (const x of [2, W - 3]) for (let z = 9; z <= 12; z++) m.box(x, 34, z, x, 37, z, hex('5a6068'))
  m.box(4, 38, 12, W - 5, 38, 13, s.glass)
  // the mast, raked back, with its radar
  for (let z = 15; z <= 21; z++) m.box(7, 31 - Math.floor((z - 15) / 2), z, 8, 31 - Math.floor((z - 15) / 2), z, GUN)
  radarMast(m, 7, 28, 22, 22, angle, 3)
  // two funnels and the after superstructure
  m.box(4, 16, 7, W - 5, 26, 11, s.navy)
  m.box(6, 22, 12, 9, 24, 15, s.navy2)
  m.box(6, 17, 12, 9, 19, 14, s.navy2)
  m.box(6, 23, 16, 9, 23, 16, GUN)
  // vertical launch cells fore and aft
  for (const y0 of [44, 9]) for (let y = y0; y <= y0 + 4; y++) for (let x = 4; x <= W - 5; x++) m.set(x, y, 6, (x + y) % 2 ? s.track : s.navy2)
  // helicopter deck with markings
  m.box(3, 1, 6, W - 4, 6, 6, s.deck)
  for (let y = 2; y <= 5; y++) m.set(7, y, 6, COL.white)
  m.box(6, 3, 6, 9, 3, 6, COL.white)
  raft(m, 1, 20, 7)
  raft(m, W - 2, 20, 7)
  raft(m, 1, 23, 7)
  raft(m, W - 2, 23, 7)
  railing(m, 7, 1, 44)
  m.box(3, 29, 14, 3, 31, 14, s.team)
  m.box(W - 4, 29, 14, W - 4, 31, 14, s.team)
  m.py = L / 2
  return m
}

/** Slava: sixteen big launch tubes along the sides of the foredeck, a tall superstructure and big radars */
function slava(angle: number): Vox {
  const s = SCHEMES.ru
  const W = 17, L = 62
  const m = new Vox(W, L, 28)
  shipHull(m, W, L, 6, 18, s.navy, s.navy2, 8)
  m.box(1, 0, 6, W - 2, 44, 6, s.deck)
  // the P-1000 tubes in pairs, angled up towards the bow
  for (let k = 0; k < 4; k++) {
    const y = 32 + k * 3
    for (const x of [0, W - 3]) {
      m.box(x, y, 7, x + 2, y + 2, 8 + Math.floor(k / 2), s.camo2)
      m.set(x + 1, y + 2, 8 + Math.floor(k / 2), s.track)
    }
  }
  // superstructure, tower, radars
  m.box(4, 14, 7, W - 5, 31, 13, s.navy)
  m.box(5, 30, 11, W - 6, 30, 12, s.glass)
  m.box(6, 21, 14, W - 7, 27, 19, s.navy2)
  radarMast(m, 8, 24, 20, 22, angle, 4)
  m.ball(8, 16, 15, 2.2, 2.2, 1.6, COL.white) // fire control dome
  m.box(5, 10, 7, W - 6, 13, 11, s.navy2) // funnel block
  m.box(6, 11, 12, W - 7, 12, 12, GUN)
  // the twin gun aft, the helideck
  m.box(3, 1, 6, W - 4, 6, 6, s.deck)
  m.set(8, 3, 6, COL.white)
  raft(m, 1, 18, 7)
  raft(m, W - 2, 18, 7)
  raft(m, 1, 22, 7)
  raft(m, W - 2, 22, 7)
  railing(m, 7, 1, 46)
  m.box(4, 15, 13, 4, 17, 13, s.team)
  m.box(W - 5, 15, 13, W - 5, 17, 13, s.team)
  m.py = L / 2
  return m
}

/** LCU 1700 / Ondatra: a flat landing craft with a bow ramp and the bridge aft */
function landingCraft(f: Faction): Vox {
  const s = SCHEMES[f]
  const W = 15, L = 36
  const m = new Vox(W, L, 14)
  for (let y = 0; y < L; y++)
    for (let x = 0; x < W; x++) {
      const bow = y > L - 4 ? y - (L - 4) : 0
      if (bow && (x < bow - 1 || x > W - bow)) continue
      m.box(x, y, 0, x, y, 4, x === 0 || x === W - 1 ? s.navy2 : s.navy)
      m.set(x, y, 0, s.navy2)
    }
  m.box(2, 10, 2, W - 3, L - 4, 4, -1)
  m.box(2, 10, 1, W - 3, L - 4, 1, s.deck)
  for (let y = 11; y <= L - 5; y += 3) m.box(3, y, 2, W - 4, y, 2, shade(s.deck, 0.85))
  m.box(1, L - 3, 4, W - 2, L - 1, 5, COL.hazard) // the ramp
  for (let x = 2; x <= W - 3; x += 2) m.set(x, L - 1, 5, s.navy2)
  // the bridge
  m.box(1, 0, 5, W - 2, 9, 9, s.navy)
  m.box(2, 9, 8, W - 3, 9, 9, s.glass)
  m.box(4, 2, 10, W - 5, 6, 10, s.navy2)
  antenna(m, 7, 4, 11, 2)
  raft(m, 0, 4, 5)
  railing(m, 5, 10, L - 5)
  m.box(3, 1, 9, W - 4, 1, 9, s.team)
  m.py = L / 2
  return m
}

/** Nimitz / Kusnezow: the angled flight deck, the island with its radars, jets ranged on deck; Kusnezow has a ski-jump bow */
function carrierShip(f: Faction): Vox {
  const s = SCHEMES[f]
  const nato = f === 'nato'
  const W = 26, L = 84
  const m = new Vox(W, L, 30)
  const cx = (W - 1) / 2
  for (let y = 0; y < L; y++) {
    const k = y > L - 18 ? (L - 1 - y) / 17 : 1
    const half = Math.max(1, 9 * Math.sqrt(k))
    for (let x = 0; x < W; x++) if (Math.abs(x - cx) <= half) {
      m.box(x, y, 0, x, y, 6, s.navy)
      m.set(x, y, 0, s.navy2)
      m.set(x, y, 1, shade(s.navy2, 1.15))
    }
  }
  // the flight deck overhangs the hull
  for (let y = 2; y < L - 1; y++) {
    const k = y > L - 10 ? (L - 1 - y) / 9 : 1
    const half = Math.max(2, 12.5 * Math.sqrt(k))
    const skew = y < 40 ? (40 - y) * 0.06 : 0 // the angled deck leans out to port
    for (let x = 0; x < W; x++) if (x - cx >= -half - skew && x - cx <= half) m.set(x, y, 7, s.deck)
  }
  // a ski jump at the bow
  if (!nato) for (let y = L - 12; y < L - 1; y++) for (let x = 0; x < W; x++) if (m.get(x, y, 7)) m.box(x, y, 8, x, y, 8 + Math.floor((y - (L - 12)) / 3), s.deck)
  // markings: centre line, the angled landing line, catapult tracks
  for (let y = 4; y < L - 6; y += 3) m.set(Math.round(cx), y, 7, COL.white)
  for (let y = 4; y < 40; y++) m.set(Math.round(cx - 6 - (40 - y) * 0.06), y, 7, COL.hazard)
  if (nato) for (const x of [Math.round(cx) - 3, Math.round(cx) + 3]) for (let y = 56; y < 78; y++) m.set(x, y, 7, shade(s.deck, 0.8))
  // the island to starboard
  m.box(20, 34, 8, 24, 50, 16, s.navy)
  m.box(20, 49, 13, 24, 50, 14, s.glass)
  m.box(21, 40, 17, 23, 46, 21, s.navy2)
  m.box(22, 42, 22, 22, 42, 27, GUN)
  m.box(20, 42, 27, 24, 42, 27, GUN_HI)
  m.box(20, 36, 17, 24, 37, 18, hex('5a6068')) // radar panels
  m.set(22, 44, 22, s.team)
  // jets ranged on deck
  for (const [jx, jy] of [[4, 62], [9, 64], [4, 69], [9, 71], [16, 10], [11, 8]]) {
    m.box(jx, jy, 8, jx + 1, jy + 6, 8, s.jet2)
    m.box(jx - 2, jy + 2, 8, jx + 3, jy + 3, 8, s.jet2)
    m.set(jx, jy + 5, 9, s.glass)
  }
  // elevators and the edge of the deck
  m.box(23, 20, 7, 25, 26, 7, shade(s.deck, 0.85))
  m.px = W / 2
  m.py = L / 2
  return m
}

// ─────────────────────────────────────────────────────────── putting it together

const RADAR = [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]

export function unitModel(key: string, f: Faction): UnitModel {
  const nato = f === 'nato'
  switch (key) {
    case 'rifle':
    case 'at':
    case 'sniper':
      return infantry(f, key as Kit)
    case 'harv':
      return { hull: oreTruck(f, false), alt: oreTruck(f, true) }
    case 'scout':
      return nato
        ? { hull: fennek(), turret: fennekTurret(), mount: [0, -1, 8] }
        : { hull: brdm(), turret: brdmTurret(), mount: [0, 1, 7] }
    case 'ifv':
      return nato
        ? { hull: marder(0), hull2: marder(1), turret: marderTurret(), mount: [-2, 2, 9] }
        : { hull: bmp(0), hull2: bmp(1), turret: bmpTurret(), mount: [0, 0, 7] }
    case 'mbt':
      return nato
        ? { hull: leopard(0), hull2: leopard(1), turret: leopardTurret(), mount: [0, -2, 7] }
        : { hull: t90(0), hull2: t90(1), turret: t90Turret(), mount: [0, -1, 6] }
    case 'aa':
      return nato
        ? { hull: gepard(0), hull2: gepard(1), turret: gepardTurret(0), turretAnim: RADAR.map((a) => gepardTurret(a)), mount: [0, -2, 7] }
        : { hull: tunguska(0), hull2: tunguska(1), turret: tunguskaTurret(0), turretAnim: RADAR.map((a) => tunguskaTurret(a)), mount: [0, -2, 7] }
    case 'art':
      return nato
        ? { hull: pzh(0), hull2: pzh(1), turret: pzhTurret(), mount: [0, -5, 6] }
        : { hull: msta(0), hull2: msta(1), turret: mstaTurret(), mount: [0, -5, 6] }
    case 'mlrs':
      return nato
        ? { hull: mars(0), hull2: mars(1), turret: marsTurret(), mount: [0, -5, 6] }
        : { hull: grad(), turret: gradTurret(), mount: [0, -5, 5] }
    case 'heli':
      return nato ? apache() : hind()
    case 'jet':
      return { hull: nato ? eurofighter() : su34(), muzzle: [10, 0] }
    case 'boat':
      return patrolBoat(f)
    case 'corvette': {
      const t = navalGun(8, SCHEMES[f].navy2)
      return { hull: corvetteShip(f, 0), hullAnim: RADAR.map((a) => corvetteShip(f, a)), turret: t, mount: [0, 13, 6], muzzle: [10, 1] }
    }
    case 'destroyer': {
      const t = navalGun(nato ? 10 : 9, SCHEMES[f].navy)
      const make = nato ? burke : slava
      return { hull: make(0), hullAnim: RADAR.map((a) => make(a)), turret: t, mount: [0, nato ? 19 : 22, 7], muzzle: [12, 1] }
    }
    case 'lander':
      return { hull: landingCraft(f) }
    case 'carrier':
      return { hull: carrierShip(f) }
  }
  throw new Error('unknown unit ' + key)
}

void mix
