// Life on the map for the next version: fences and hedges, cars and a tractor, power lines, wind
// turbines, hay bales, cows and sheep, a wayside cross, sandbag positions and tank obstacles.
// Only exported as sprites (export.html); the browser game does not place them.
//
// Axes as for vehicles: x across, y along (the front is at the high end), z up; 16 units a tile.

import { Vox } from '../core/voxel'
import { hex, shade } from '../core/iso'
import { hash3, mulberry32 } from '../core/rng'
import { COL } from './colors'

export interface DecoDef {
  key: string
  name: string
  /** headings (1: drawn as it stands, otherwise a full turn) */
  dirs: number
  variants: number
  /** animation frames or poses */
  frames: number
  frameNote?: string
  make: (variant: number, frame: number) => Vox
}

const STEEL = hex('6d7376'), STEEL_D = hex('4a5052'), RUBBER = hex('1f1f1d'), GLASS = hex('2f4250'), LAMP = hex('fff1b0')

// ─────────────────────────────────────────────────────────── field and village

function fence(alongX: boolean, v: number): Vox {
  const m = new Vox(16, 16, 8)
  const wood = v ? hex('8a7a62') : COL.wood
  const post = (a: number) => (alongX ? m.box(a, 7.5, 0, a + 0.5, 8, 5, shade(wood, 0.85)) : m.box(7.5, a, 0, 8, a + 0.5, 5, shade(wood, 0.85)))
  for (const a of [0.5, 5.5, 10.5, 15]) post(a)
  for (const z of [2, 4]) {
    if (alongX) m.box(0, 7.5, z, 15.5, 7.5, z + 0.5, wood)
    else m.box(7.5, 0, z, 7.5, 15.5, z + 0.5, wood)
  }
  return m
}

function hedge(alongX: boolean, v: number): Vox {
  const m = new Vox(16, 16, 8)
  const r = mulberry32(v * 31 + 7)
  for (let a = 0; a < 16; a += 1.5) {
    const h = 3.5 + r() * 2
    const x = alongX ? a : 8, y = alongX ? 8 : a
    m.ball(x, y, h * 0.55, 2.2, 2.2, h * 0.6, r() < 0.5 ? COL.leaf1 : COL.leaf2)
  }
  m.paint((x, y, z, c) => (c === COL.leaf2 && hash3(x * 3, y * 3, z * 3) < 0.15 ? COL.leaf3 : c))
  return m
}

const CAR_COLS = [hex('a8322a'), hex('2f5a8a'), hex('d8d6cc'), hex('8f9496'), hex('c9a33a'), hex('3d5a3a')]

function car(kind: 'sedan' | 'hatch' | 'van', v: number): Vox {
  const m = new Vox(8, 14, 7)
  const c = CAR_COLS[v % CAR_COLS.length]
  const L = kind === 'hatch' ? 9 : kind === 'van' ? 11 : 11
  const y0 = (14 - L) / 2, y1 = y0 + L - 1
  // body, cabin, windows
  m.box(1.5, y0, 1, 6, y1, 2.5, c)
  if (kind === 'van') {
    m.box(1.5, y0, 3, 6, y1 - 2, 5, c)
    m.box(1.5, y1 - 1.5, 3, 6, y1, 3.5, c)
    m.box(1.5, y1 - 2, 3.5, 6, y1 - 2, 4.5, GLASS)
    m.box(1.5, y0 + 1, 4, 1.5, y1 - 3, 4.5, GLASS)
    m.box(6, y0 + 1, 4, 6, y1 - 3, 4.5, GLASS)
  } else {
    const c0 = y0 + (kind === 'hatch' ? 1 : 2.5), c1 = y1 - 3
    m.box(2, c0, 3, 5.5, c1, 4.5, c)
    m.box(2, c1, 3, 5.5, c1, 4, GLASS)
    m.box(2, c0, 3, 5.5, c0, 4, GLASS)
    m.box(2, c0 + 1, 3.5, 2, c1 - 1, 4, GLASS)
    m.box(5.5, c0 + 1, 3.5, 5.5, c1 - 1, 4, GLASS)
  }
  // wheels, lights
  for (const y of [y0 + 1.5, y1 - 1.5]) {
    m.cylX(y, 1, 1, 1, 1.5, RUBBER)
    m.cylX(y, 1, 1, 6, 6.5, RUBBER)
  }
  m.dot(2, y1 + 0.5, 2, LAMP, true)
  m.dot(5.5, y1 + 0.5, 2, LAMP, true)
  m.dot(2, y0, 2, hex('c03a2a'))
  m.dot(5.5, y0, 2, hex('c03a2a'))
  m.px = 4
  m.py = 7
  return m
}

function tractor(v: number): Vox {
  const m = new Vox(9, 14, 9)
  const c = v ? hex('3f7a3a') : hex('b8442e')
  m.box(3, 6, 2, 6, 12, 4, c) // bonnet
  m.box(2.5, 2, 2, 6.5, 6, 6.5, c) // cab
  m.box(3, 2.5, 4.5, 6, 5.5, 6, GLASS)
  m.box(2.5, 2, 7, 6.5, 6, 7, shade(c, 0.8))
  m.rod(5.5, 11, 4, 5.5, 11, 7, STEEL_D) // exhaust
  m.cylX(4, 3, 3, 0.5, 2, RUBBER) // big rear wheels
  m.cylX(4, 3, 3, 7, 8.5, RUBBER)
  m.cylX(11, 1.6, 1.6, 1.5, 2.5, RUBBER)
  m.cylX(11, 1.6, 1.6, 6.5, 7.5, RUBBER)
  m.px = 4.5
  m.py = 7
  return m
}

function polePower(): Vox {
  const m = new Vox(12, 6, 30)
  m.box(5.5, 2.5, 0, 6.5, 3.5, 26, hex('5a4636'))
  m.box(1, 2.5, 25, 11, 3.5, 25.5, hex('5a4636'))
  for (const x of [1.5, 6, 10.5]) {
    m.box(x, 2.75, 26, x + 0.5, 3.25, 27, COL.white)
    m.rod(x + 0.25, 0, 27, x + 0.25, 6, 27, hex('2a2c28'))
  }
  return m
}

function pylon(): Vox {
  const m = new Vox(24, 12, 46)
  const steel = hex('8a9092')
  // four legs leaning in, cross bracing, two arms with insulators
  for (const [x, y] of [[2, 2], [21, 2], [2, 9], [21, 9]]) m.rod(x, y, 0, 12 + (x - 12) * 0.25, 6 + (y - 6) * 0.3, 40, steel)
  for (let z = 4; z < 40; z += 6) {
    const k = 1 - (z / 40) * 0.75
    const a = 12 - 10 * k, b = 12 + 10 * k, c = 6 - 4 * k, d = 6 + 4 * k
    m.rod(a, c, z, b, c, z + 6, steel)
    m.rod(b, c, z, a, c, z + 6, steel)
    m.rod(a, d, z, b, d, z + 6, steel)
    m.rod(a, c, z, a, d, z, steel)
    m.rod(b, c, z, b, d, z, steel)
  }
  for (const z of [30, 38]) {
    m.rod(1, 6, z, 23, 6, z, steel)
    for (const x of [1.5, 22.5]) m.box(x, 5.75, z - 3, x + 0.5, 6.25, z - 0.5, COL.white)
  }
  m.box(11.5, 5.5, 40, 12.5, 6.5, 44, steel)
  return m
}

function windTurbine(frame: number): Vox {
  const m = new Vox(42, 16, 80)
  const W = hex('e6e6de'), W2 = hex('c8c8c0')
  const cx = 21, cy = 7, top = 60
  for (let z = 0; z <= top; z++) m.cylZ(cx, cy, 1.9 - z * 0.012, z, z, z % 12 === 0 ? W2 : W)
  m.box(cx - 1.5, cy - 3, top + 1, cx + 1.5, cy + 3.5, top + 3.5, W) // nacelle
  m.ball(cx, cy + 4.5, top + 2.25, 1.2, 1.2, 1.2, W2) // hub
  // three blades turning in the x-z plane in front of the hub
  for (let b = 0; b < 3; b++) {
    const a = (frame / 6) * ((Math.PI * 2) / 3) + (b * Math.PI * 2) / 3
    const L = 19
    for (let t = 1.2; t <= L; t += 0.25) {
      const w = t < 4 ? 0.9 : 0.9 - (t - 4) * 0.035
      const x = cx + Math.sin(a) * t, z = top + 2.25 + Math.cos(a) * t
      m.box(x - w * 0.5, cy + 5, z - w * 0.5, x + w * 0.5, cy + 5, z + w * 0.5, t > L - 2 ? hex('c03a2a') : W)
    }
  }
  m.px = cx
  m.py = cy
  return m
}

function hayBales(v: number): Vox {
  const m = new Vox(16, 16, 8)
  const r = mulberry32(v * 13 + 3)
  if (v < 2) {
    // round bales lying on their side
    const n = 2 + v
    for (let i = 0; i < n; i++) {
      const x = 3 + i * 4.5 + r(), y = 5 + r() * 6
      m.cylX(y, 2.4, 2.4, x - 1.8, x + 1.8, i % 2 ? COL.hay : shade(COL.hay, 0.92))
    }
    m.paint((x, y, z, c) => (c === COL.hay && hash3(x, y, z) < 0.2 ? shade(c, 0.85) : c))
  } else {
    // a stack of square bales
    for (let k = 0; k < 3; k++) m.box(3 + k * 3.5, 5, 0, 5.8 + k * 3.5, 10, 2, COL.hay)
    for (let k = 0; k < 2; k++) m.box(4.7 + k * 3.5, 5.5, 2.5, 7.5 + k * 3.5, 9.5, 4.5, shade(COL.hay, 0.94))
    m.paint((x, y, z, c) => ((c === COL.hay || c === shade(COL.hay, 0.94)) && (y * 7) % 5 === 0 ? shade(c, 0.82) : c))
  }
  return m
}

function cow(v: number, graze: boolean): Vox {
  const m = new Vox(6, 13, 9)
  const body = v === 1 ? hex('7a4a2e') : COL.white
  const spot = v === 1 ? hex('5a3420') : hex('2a2624')
  for (const [x, y] of [[1.5, 3], [4, 3], [1.5, 8.5], [4, 8.5]]) m.box(x, y, 0, x + 0.5, y + 0.5, 3, shade(body, 0.85))
  m.box(1.5, 2.5, 3.5, 4.5, 9.5, 6.5, body)
  m.paint((x, y, z, c) => (c === body && hash3(x >> 2, y >> 2, z >> 2) < 0.35 ? spot : c))
  const hz = graze ? 1.5 : 6, hy = graze ? 11 : 10.5
  m.box(2.25, hy - 0.5, hz, 3.75, hy + 1.5, hz + 2, body)
  m.box(2.5, hy + 1.5, hz, 3.5, hy + 2, hz + 1, hex('d8a090'))
  m.dot(1.75, hy, hz + 2, hex('d8d0b8'))
  m.dot(4, hy, hz + 2, hex('d8d0b8'))
  m.rod(3, 2.5, 6, 3, 1.5, 3.5, body) // tail
  m.px = 3
  m.py = 6.5
  return m
}

function sheep(graze: boolean): Vox {
  const m = new Vox(5, 9, 6)
  for (const [x, y] of [[1.5, 2.5], [3, 2.5], [1.5, 5.5], [3, 5.5]]) m.box(x, y, 0, x + 0.25, y + 0.25, 2, hex('2a2624'))
  m.ball(2.5, 4.3, 3.2, 1.9, 2.6, 1.6, hex('e8e4d6'))
  m.paint((x, y, z, c) => (c === hex('e8e4d6') && hash3(x, y, z) < 0.3 ? hex('d4cfbe') : c))
  const hz = graze ? 1 : 3.5
  m.box(2, 7, hz, 3, 8, hz + 1.25, hex('2a2624'))
  m.px = 2.5
  m.py = 4.5
  return m
}

function waysideCross(): Vox {
  const m = new Vox(8, 8, 18)
  m.box(2.5, 2.5, 0, 5.5, 5.5, 1, COL.rock3) // stone base
  m.box(3.75, 3.75, 2, 4.25, 4.25, 15, COL.timber)
  m.box(2, 3.75, 11, 6, 4.25, 11.5, COL.timber)
  // a little roof over it
  m.box(2.5, 3, 15.5, 5.5, 5, 15.5, COL.roofDark)
  m.box(3, 3.25, 16, 5, 4.75, 16, shade(COL.roofDark, 0.9))
  m.dot(4, 4.5, 11, hex('c9a33a')) // the figure
  m.dot(4, 4.5, 10.5, hex('c9a33a'))
  return m
}

// ─────────────────────────────────────────────────────────── field works

function sandbagRing(open: number): Vox {
  const m = new Vox(16, 16, 6)
  for (let a = 0; a < Math.PI * 2; a += 0.05) {
    const side = Math.floor((((a + Math.PI / 4) % (Math.PI * 2)) / (Math.PI / 2)))
    if (side === open) continue
    const x = 8 + Math.cos(a) * 6, y = 8 + Math.sin(a) * 6
    for (let z = 0; z < 3; z++) {
      const c = hash3(Math.round(x * 2), Math.round(y * 2), z) < 0.3 ? shade(COL.sandbag, 0.86) : COL.sandbag
      m.box(x - 0.75, y - 0.75, z, x + 0.75, y + 0.75, z + 0.5, c)
    }
  }
  return m
}

function sandbagWall(alongX: boolean): Vox {
  const m = new Vox(16, 16, 6)
  for (let a = 0; a < 16; a += 1.5)
    for (let z = 0; z < 3; z++) {
      const o = z % 2 ? 0.75 : 0
      const x = alongX ? a + o : 7, y = alongX ? 7 : a + o
      const c = hash3(Math.round(a * 2), z, alongX ? 1 : 2) < 0.3 ? shade(COL.sandbag, 0.86) : COL.sandbag
      m.box(x, y, z, x + (alongX ? 1.25 : 1.75), y + (alongX ? 1.75 : 1.25), z + 0.75, c)
    }
  return m
}

function hedgehog(v: number): Vox {
  const m = new Vox(10, 10, 9)
  const c = v ? hex('5d5348') : STEEL_D
  // three beams crossing in the middle
  m.rod(1, 5, 0.5, 9, 5, 7.5, c)
  m.rod(9, 5, 0.5, 1, 5, 7.5, c)
  m.rod(5, 1, 0.5, 5, 9, 7.5, c)
  m.rod(5, 9, 0.5, 5, 1, 7.5, c)
  m.rod(2, 2, 4, 8, 8, 4, c)
  m.rod(8, 2, 4, 2, 8, 4, c)
  m.paint((x, y, z, cc) => (hash3(x, y, z) < 0.2 ? COL.rust : cc))
  return m
}

function dragonTeeth(alongX: boolean): Vox {
  const m = new Vox(16, 16, 7)
  for (let i = 0; i < 4; i++) {
    const a = 2 + i * 4
    for (let z = 0; z < 6; z++) {
      const k = 1.5 - z * 0.22
      const x = alongX ? a : 8, y = alongX ? 8 : a
      m.box(x - k, y - k, z, x + k, y + k, z, z % 2 ? COL.concrete : COL.concrete2)
    }
  }
  return m
}

export const DECO: DecoDef[] = [
  { key: 'fence_x', name: 'Holzzaun (entlang x)', dirs: 1, variants: 2, frames: 1, make: (v) => fence(true, v) },
  { key: 'fence_y', name: 'Holzzaun (entlang y)', dirs: 1, variants: 2, frames: 1, make: (v) => fence(false, v) },
  { key: 'hedge_x', name: 'Hecke (entlang x)', dirs: 1, variants: 3, frames: 1, make: (v) => hedge(true, v) },
  { key: 'hedge_y', name: 'Hecke (entlang y)', dirs: 1, variants: 3, frames: 1, make: (v) => hedge(false, v) },
  { key: 'car_sedan', name: 'Kombi', dirs: 8, variants: 4, frames: 1, make: (v) => car('sedan', v) },
  { key: 'car_hatch', name: 'Kleinwagen', dirs: 8, variants: 4, frames: 1, make: (v) => car('hatch', v + 2) },
  { key: 'car_van', name: 'Transporter', dirs: 8, variants: 3, frames: 1, make: (v) => car('van', [2, 0, 5][v]) },
  { key: 'tractor', name: 'Traktor', dirs: 8, variants: 2, frames: 1, make: (v) => tractor(v) },
  { key: 'pole', name: 'Holz-Strommast', dirs: 2, variants: 1, frames: 1, make: () => polePower() },
  { key: 'pylon', name: 'Hochspannungsmast', dirs: 2, variants: 1, frames: 1, make: () => pylon() },
  { key: 'wind_turbine', name: 'Windrad', dirs: 1, variants: 1, frames: 6, frameNote: 'Rotor: 6 Bilder für eine Drittel-Umdrehung, im Kreis abspielen (etwa 8 pro Sekunde)', make: (_v, f) => windTurbine(f) },
  { key: 'hay', name: 'Heuballen', dirs: 1, variants: 3, frames: 1, make: (v) => hayBales(v) },
  { key: 'cow', name: 'Kuh', dirs: 8, variants: 2, frames: 2, frameNote: 'Bild 0 stehen, Bild 1 grasen', make: (v, f) => cow(v, f === 1) },
  { key: 'sheep', name: 'Schaf', dirs: 8, variants: 1, frames: 2, frameNote: 'Bild 0 stehen, Bild 1 grasen', make: (_v, f) => sheep(f === 1) },
  { key: 'wayside_cross', name: 'Wegkreuz', dirs: 1, variants: 1, frames: 1, make: () => waysideCross() },
  { key: 'sandbag_ring', name: 'Sandsack-Stellung', dirs: 1, variants: 4, frames: 1, frameNote: 'Variante = Seite der Öffnung (+x, +y, -x, -y)', make: (v) => sandbagRing(v) },
  { key: 'sandbag_wall_x', name: 'Sandsackwall (entlang x)', dirs: 1, variants: 1, frames: 1, make: () => sandbagWall(true) },
  { key: 'sandbag_wall_y', name: 'Sandsackwall (entlang y)', dirs: 1, variants: 1, frames: 1, make: () => sandbagWall(false) },
  { key: 'hedgehog', name: 'Panzersperre (Tschechenigel)', dirs: 1, variants: 2, frames: 1, make: (v) => hedgehog(v) },
  { key: 'dragon_teeth_x', name: 'Höckersperre (entlang x)', dirs: 1, variants: 1, frames: 1, make: () => dragonTeeth(true) },
  { key: 'dragon_teeth_y', name: 'Höckersperre (entlang y)', dirs: 1, variants: 1, frames: 1, make: () => dragonTeeth(false) },
]
