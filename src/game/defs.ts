// What every unit, building and weapon is worth. Ranges and speeds are in tiles, times in seconds.
import type { Faction } from './colors'

export type Armor = 'inf' | 'light' | 'heavy' | 'bld' | 'air'
export type WClass = 'mg' | 'cannon' | 'auto' | 'rocket' | 'art' | 'flak'
export type Proj = 'bullet' | 'shell' | 'rocket' | 'art' | 'mlrs' | 'flak'

export interface WeaponDef {
  cls: WClass
  proj: Proj
  dmg: number
  range: number
  minRange?: number
  reload: number
  /** shots per volley and the gap between them */
  burst?: number
  gap?: number
  splash?: number
  ground: boolean
  air: boolean
}

/** damage of a weapon class against an armour class */
export const VS: Record<WClass, Record<Armor, number>> = {
  mg: { inf: 1, light: 0.3, heavy: 0.08, bld: 0.2, air: 0.25 },
  cannon: { inf: 0.35, light: 1, heavy: 0.9, bld: 0.75, air: 0 },
  auto: { inf: 0.85, light: 0.8, heavy: 0.25, bld: 0.35, air: 0.6 },
  rocket: { inf: 0.3, light: 1, heavy: 1, bld: 0.65, air: 0.9 },
  art: { inf: 0.9, light: 0.7, heavy: 0.45, bld: 1, air: 0 },
  flak: { inf: 0.7, light: 0.3, heavy: 0.1, bld: 0.15, air: 1.5 },
}

export type Producer = 'hq' | 'barracks' | 'factory' | 'helipad'
export type Queue = 'build' | 'inf' | 'veh' | 'air'

export interface UnitDef {
  key: string
  name: string
  desc: string
  cost: number
  time: number
  hp: number
  armor: Armor
  speed: number
  /** how fast the hull turns, rad/s (0: turns at once) */
  turn: number
  sight: number
  radius: number
  weapon?: WeaponDef
  queue: Queue
  req: string[]
  air?: boolean
  infantry?: boolean
  harvester?: boolean
  hotkey: string
}

export interface BuildingDef {
  key: string
  name: string
  desc: string
  cost: number
  time: number
  hp: number
  w: number
  h: number
  power: number
  sight: number
  weapon?: WeaponDef
  produces?: Queue
  req: string[]
  defense?: boolean
  hotkey: string
}

const rifle: WeaponDef = { cls: 'mg', proj: 'bullet', dmg: 9, range: 4, reload: 0.9, burst: 3, gap: 0.12, ground: true, air: true }
const atRocket: WeaponDef = { cls: 'rocket', proj: 'rocket', dmg: 55, range: 5, reload: 2.8, ground: true, air: true }

export function unitDefs(f: Faction): Record<string, UnitDef> {
  const nato = f === 'nato'
  return {
    rifle: {
      key: 'rifle', name: 'Schütze', desc: 'Günstige Infanterie. Stark gegen Infanterie.',
      cost: 100, time: 4, hp: 55, armor: 'inf', speed: 0.85, turn: 0, sight: 6, radius: 0.16,
      weapon: rifle, queue: 'inf', req: ['barracks'], infantry: true, hotkey: 'Q',
    },
    at: {
      key: 'at', name: 'Panzerabwehr', desc: 'Raketen gegen Fahrzeuge und Hubschrauber.',
      cost: 250, time: 6, hp: 45, armor: 'inf', speed: 0.75, turn: 0, sight: 6, radius: 0.16,
      weapon: atRocket, queue: 'inf', req: ['barracks'], infantry: true, hotkey: 'W',
    },
    harv: {
      key: 'harv', name: 'Erzlaster', desc: 'Sammelt Erz und bringt es zum Rohstoffdepot.',
      cost: 1000, time: 12, hp: 650, armor: 'light', speed: 1.15, turn: 3.2, sight: 4, radius: 0.5,
      queue: 'veh', req: ['factory', 'ref'], harvester: true, hotkey: 'Q',
    },
    ifv: {
      key: 'ifv', name: nato ? 'Schützenpanzer' : 'Schützenpanzer (BMP)', desc: 'Schnell, Maschinenkanone. Gut gegen Infanterie und leichte Fahrzeuge.',
      cost: 550, time: 9, hp: 320, armor: 'light', speed: 2.0, turn: 3.6, sight: 7, radius: 0.46,
      weapon: { cls: 'auto', proj: 'shell', dmg: 13, range: 5, reload: 0.9, burst: 3, gap: 0.14, ground: true, air: true },
      queue: 'veh', req: ['factory'], hotkey: 'W',
    },
    mbt: {
      key: 'mbt', name: 'Kampfpanzer', desc: nato ? 'Präzise Kanone mit hoher Reichweite.' : 'Schwer gepanzert und günstiger.',
      cost: nato ? 950 : 850, time: 13, hp: nato ? 620 : 700, armor: 'heavy', speed: nato ? 1.45 : 1.35, turn: 2.2, sight: 7, radius: 0.5,
      weapon: { cls: 'cannon', proj: 'shell', dmg: nato ? 72 : 78, range: nato ? 6 : 5.5, reload: nato ? 2.6 : 3.0, ground: true, air: false },
      queue: 'veh', req: ['factory'], hotkey: 'E',
    },
    aa: {
      key: 'aa', name: 'Flakpanzer', desc: 'Holt Hubschrauber vom Himmel. Hilft gegen Infanterie.',
      cost: 700, time: 10, hp: 300, armor: 'light', speed: 1.6, turn: 3, sight: 8, radius: 0.46,
      weapon: nato
        ? { cls: 'flak', proj: 'flak', dmg: 15, range: 6.5, reload: 0.7, burst: 4, gap: 0.08, ground: true, air: true }
        : { cls: 'flak', proj: 'flak', dmg: 17, range: 6, reload: 0.8, burst: 4, gap: 0.09, ground: true, air: true },
      queue: 'veh', req: ['factory', 'radar'], hotkey: 'R',
    },
    art: {
      key: 'art', name: nato ? 'Panzerhaubitze' : 'Raketenwerfer', desc: nato ? 'Weitreichende Haubitze mit Flächenschaden.' : 'Salven aus sechs Raketen auf große Entfernung.',
      cost: 1000, time: 14, hp: 260, armor: 'light', speed: 1.1, turn: 2.2, sight: 6, radius: 0.5,
      weapon: nato
        ? { cls: 'art', proj: 'art', dmg: 120, range: 12, minRange: 3, reload: 5.5, splash: 1.1, ground: true, air: false }
        : { cls: 'art', proj: 'mlrs', dmg: 42, range: 11, minRange: 3, reload: 9, burst: 6, gap: 0.18, splash: 0.9, ground: true, air: false },
      queue: 'veh', req: ['factory', 'radar'], hotkey: 'T',
    },
    heli: {
      key: 'heli', name: 'Kampfhubschrauber', desc: 'Fliegt über alles hinweg. Raketen gegen Fahrzeuge.',
      cost: 1300, time: 15, hp: nato ? 360 : 420, armor: 'air', speed: 2.6, turn: 2.6, sight: 8, radius: 0.5,
      weapon: { cls: 'rocket', proj: 'rocket', dmg: nato ? 40 : 34, range: 5, reload: 2.2, burst: 2, gap: 0.2, ground: true, air: false },
      queue: 'air', req: ['helipad'], air: true, hotkey: 'Q',
    },
  }
}

export function buildingDefs(): Record<string, BuildingDef> {
  return {
    hq: { key: 'hq', name: 'Hauptquartier', desc: 'Baut alle Gebäude.', cost: 3000, time: 30, hp: 2200, w: 3, h: 3, power: 20, sight: 8, req: ['__never'], produces: 'build', hotkey: '' },
    power: { key: 'power', name: 'Kraftwerk', desc: 'Liefert Strom. Ohne Strom läuft alles langsamer.', cost: 300, time: 6, hp: 650, w: 2, h: 2, power: 100, sight: 4, req: ['hq'], hotkey: 'Q' },
    ref: { key: 'ref', name: 'Rohstoffdepot', desc: 'Nimmt Erz an. Mit einem Erzlaster.', cost: 1600, time: 12, hp: 1100, w: 3, h: 3, power: -30, sight: 5, req: ['power'], hotkey: 'W' },
    barracks: { key: 'barracks', name: 'Kaserne', desc: 'Bildet Infanterie aus.', cost: 400, time: 7, hp: 750, w: 2, h: 2, power: -20, sight: 5, req: ['power'], produces: 'inf', hotkey: 'E' },
    factory: { key: 'factory', name: 'Fahrzeugwerk', desc: 'Baut Fahrzeuge.', cost: 1800, time: 14, hp: 1500, w: 3, h: 3, power: -30, sight: 5, req: ['ref'], produces: 'veh', hotkey: 'R' },
    radar: { key: 'radar', name: 'Radarstation', desc: 'Schaltet Artillerie und Flak frei. Große Sicht.', cost: 900, time: 10, hp: 900, w: 2, h: 2, power: -40, sight: 10, req: ['factory'], hotkey: 'T' },
    helipad: { key: 'helipad', name: 'Hubschrauberplatz', desc: 'Baut Kampfhubschrauber.', cost: 1200, time: 11, hp: 850, w: 2, h: 2, power: -20, sight: 5, req: ['radar'], produces: 'air', hotkey: 'Y' },
    bunker: {
      key: 'bunker', name: 'MG-Bunker', desc: 'Verteidigung gegen Infanterie und leichte Fahrzeuge.', cost: 500, time: 7, hp: 800, w: 1, h: 1, power: -10, sight: 6,
      weapon: { cls: 'auto', proj: 'bullet', dmg: 12, range: 5.5, reload: 0.9, burst: 4, gap: 0.1, ground: true, air: false },
      req: ['barracks'], defense: true, hotkey: 'A',
    },
    rocket: {
      key: 'rocket', name: 'Raketenstellung', desc: 'Verteidigung gegen Panzer und Hubschrauber.', cost: 750, time: 9, hp: 600, w: 1, h: 1, power: -20, sight: 7,
      weapon: { cls: 'rocket', proj: 'rocket', dmg: 50, range: 7, reload: 2.4, burst: 2, gap: 0.25, ground: true, air: true },
      req: ['factory'], defense: true, hotkey: 'S',
    },
  }
}

export const BUILD_ORDER = ['power', 'ref', 'barracks', 'factory', 'radar', 'helipad', 'bunker', 'rocket']
export const UNIT_ORDER = ['rifle', 'at', 'harv', 'ifv', 'mbt', 'aa', 'art', 'heli']

export const START_CREDITS = 5000
export const HARVEST_LOAD = 400
export const ORE_PER_TILE = 900
export const BUILD_RADIUS = 5
