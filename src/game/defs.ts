// What every unit, building and weapon is worth. Ranges and speeds are in tiles, times in seconds.
import type { Faction } from './colors'

export type Armor = 'inf' | 'light' | 'heavy' | 'bld' | 'air' | 'ship'
export type WClass = 'mg' | 'cannon' | 'auto' | 'rocket' | 'art' | 'flak' | 'sniper' | 'missile'
export type Proj = 'bullet' | 'shell' | 'rocket' | 'art' | 'mlrs' | 'flak' | 'missile' | 'snipe'

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
  /** what it can shoot at: things on land, in the air, on the water (default: as on land) */
  ground: boolean
  air: boolean
  sea?: boolean
}

/** damage of a weapon class against an armour class */
export const VS: Record<WClass, Record<Armor, number>> = {
  mg: { inf: 1, light: 0.2, heavy: 0.05, bld: 0.2, air: 0.06, ship: 0.15 },
  cannon: { inf: 0.45, light: 1, heavy: 0.9, bld: 0.75, air: 0, ship: 0.8 },
  auto: { inf: 0.85, light: 0.8, heavy: 0.25, bld: 0.35, air: 0.25, ship: 0.6 },
  rocket: { inf: 0.3, light: 1, heavy: 1, bld: 0.65, air: 0.9, ship: 0.8 },
  art: { inf: 0.9, light: 0.7, heavy: 0.45, bld: 1, air: 0, ship: 0.7 },
  flak: { inf: 0.4, light: 0.3, heavy: 0.1, bld: 0.15, air: 1.5, ship: 0.15 },
  sniper: { inf: 1.6, light: 0.05, heavy: 0.02, bld: 0.02, air: 0, ship: 0.02 },
  missile: { inf: 0.5, light: 1, heavy: 1, bld: 1, air: 0.8, ship: 1.1 },
}

export const ARMOR_NAME: Record<Armor, string> = {
  inf: 'Infanterie', light: 'leicht gepanzert', heavy: 'schwer gepanzert', bld: 'Gebäude', air: 'Luftfahrzeug', ship: 'Schiff',
}

export type Queue = 'build' | 'inf' | 'veh' | 'air' | 'sea'
export const QUEUES: Queue[] = ['build', 'inf', 'veh', 'air', 'sea']

export interface UnitDef {
  key: string
  name: string
  /** what kind of unit it is (the name is the real-world model) */
  role: string
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
  /** the building it comes out of */
  producer: string
  req: string[]
  air?: boolean
  infantry?: boolean
  harvester?: boolean
  naval?: boolean
  /** a ship's hull: half its length and half its beam, in tiles */
  hull?: [number, number]
  /** flies strikes from an airfield or a carrier and comes back */
  jet?: boolean
  /** carries this many units */
  transport?: number
  /** carries this many jets of its own */
  carrier?: number
  /** hidden from the enemy while it keeps still */
  stealth?: boolean
  /** takes over enemy buildings */
  engineer?: boolean
  /** heals soldiers nearby: hit points per second, reach in tiles */
  heal?: { rate: number; range: number }
  /** prepared for the next version (Godot): art and values exist, not playable here */
  planned?: boolean
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
  /** must stand on the shore */
  shore?: boolean
  /** how far from our other buildings it may go up (default BUILD_RADIUS) */
  reach?: number
  /** parking spots for jets */
  slots?: number
  /** soldiers it can take in */
  garrison?: number
}

const rifle: WeaponDef = { cls: 'mg', proj: 'bullet', dmg: 9, range: 4, reload: 0.9, burst: 3, gap: 0.12, ground: true, air: true }
const atRocket: WeaponDef = { cls: 'rocket', proj: 'rocket', dmg: 68, range: 5.5, reload: 2.6, ground: true, air: true }

export function unitDefs(f: Faction): Record<string, UnitDef> {
  const nato = f === 'nato'
  return {
    rifle: {
      key: 'rifle', name: nato ? 'Grenadier (G36)' : 'Schütze (AK-74)', role: 'Infanterie', desc: 'Günstige Infanterie. Stark gegen Infanterie.',
      cost: 100, time: 4, hp: 55, armor: 'inf', speed: 0.85, turn: 0, sight: 6, radius: 0.2,
      weapon: rifle, queue: 'inf', producer: 'barracks', req: ['barracks'], infantry: true,
    },
    at: {
      key: 'at', name: nato ? 'Panzerfaust 3' : 'RPG-7', role: 'Panzerabwehrtrupp', desc: 'Raketen gegen Fahrzeuge, Schiffe und Hubschrauber.',
      cost: 220, time: 6, hp: 60, armor: 'inf', speed: 0.75, turn: 0, sight: 6, radius: 0.2,
      weapon: atRocket, queue: 'inf', producer: 'barracks', req: ['barracks'], infantry: true,
    },
    sniper: {
      key: 'sniper', name: nato ? 'Scharfschütze (G22)' : 'Scharfschütze (SWD)', role: 'Scharfschütze', desc: 'Trifft Infanterie auf große Entfernung. Unsichtbar, solange er stillhält und nicht schießt.',
      cost: 350, time: 9, hp: 50, armor: 'inf', speed: 0.8, turn: 0, sight: 10, radius: 0.2,
      weapon: { cls: 'sniper', proj: 'snipe', dmg: 60, range: 9, reload: 2.8, ground: true, air: false, sea: false },
      queue: 'inf', producer: 'barracks', req: ['barracks', 'radar'], infantry: true, stealth: true,
    },
    engineer: {
      key: 'engineer', name: nato ? 'Pionier' : 'Pionier (Sapjor)', role: 'Pionier',
      desc: 'Erobert feindliche Gebäude: Rechtsklick auf das Gebäude. Wird dabei verbraucht. Ohne Waffe.',
      cost: 500, time: 8, hp: 60, armor: 'inf', speed: 0.9, turn: 0, sight: 5, radius: 0.2,
      queue: 'inf', producer: 'barracks', req: ['barracks'], infantry: true, engineer: true,
    },
    harv: {
      key: 'harv', name: nato ? 'MAN-Erzlaster' : 'KAMAZ-Erzlaster', role: 'Erzlaster', desc: 'Sammelt Erz und bringt es zum Rohstoffdepot.',
      cost: 1000, time: 12, hp: 650, armor: 'light', speed: 1.15, turn: 3.2, sight: 4, radius: 0.56,
      queue: 'veh', producer: 'factory', req: ['factory', 'ref'], harvester: true,
    },
    scout: {
      key: 'scout', name: nato ? 'Fennek' : 'BRDM-2', role: 'Spähwagen', desc: 'Sehr schnell und weitsichtig. Leichte Maschinenkanone gegen Infanterie und leichte Fahrzeuge. Zum Aufklären und Jagen von Artillerie.',
      cost: 400, time: 6, hp: 220, armor: 'light', speed: 2.7, turn: 4.2, sight: 10, radius: 0.48,
      weapon: { cls: 'auto', proj: 'bullet', dmg: 5, range: 5, reload: 1.0, burst: 4, gap: 0.09, ground: true, air: false },
      queue: 'veh', producer: 'factory', req: ['factory'],
    },
    ifv: {
      key: 'ifv', name: nato ? 'Marder 1A5' : 'BMP-2', role: 'Schützenpanzer', desc: 'Schnell, Maschinenkanone. Gut gegen Infanterie und leichte Fahrzeuge.',
      cost: 550, time: 9, hp: 320, armor: 'light', speed: 2.0, turn: 3.6, sight: 7, radius: 0.55,
      weapon: { cls: 'auto', proj: 'shell', dmg: 13, range: 5, reload: 0.9, burst: 3, gap: 0.14, ground: true, air: true },
      queue: 'veh', producer: 'factory', req: ['factory'],
    },
    mbt: {
      key: 'mbt', name: nato ? 'Leopard 2A6' : 'T-90A', role: 'Kampfpanzer', desc: 'Schwer gepanzert, starke Kanone. Das Rückgrat jeder Panzertruppe.',
      cost: 900, time: 13, hp: 660, armor: 'heavy', speed: 1.4, turn: 2.2, sight: 7, radius: 0.58,
      weapon: { cls: 'cannon', proj: 'shell', dmg: 75, range: 5.75, reload: 2.8, ground: true, air: false },
      queue: 'veh', producer: 'factory', req: ['factory'],
    },
    aa: {
      key: 'aa', name: nato ? 'Gepard 1A2' : '2K22 Tunguska', role: 'Flakpanzer', desc: 'Holt Hubschrauber und Jets vom Himmel. Hilft gegen Infanterie.',
      cost: 700, time: 10, hp: 300, armor: 'light', speed: 1.6, turn: 3, sight: 8, radius: 0.56,
      weapon: { cls: 'flak', proj: 'flak', dmg: 16, range: 6.25, reload: 0.75, burst: 4, gap: 0.085, ground: true, air: true },
      queue: 'veh', producer: 'factory', req: ['factory', 'radar'],
    },
    art: {
      key: 'art', name: nato ? 'Panzerhaubitze 2000' : '2S19 Msta-S', role: 'Rohrartillerie',
      desc: 'Panzerhaubitze: große Reichweite und Flächenschaden, schießt Doppelschüsse. Braucht Schutz, nicht zu nah ans Ziel.',
      cost: 1000, time: 14, hp: 290, armor: 'light', speed: 1.12, turn: 2.2, sight: 6, radius: 0.58,
      weapon: { cls: 'art', proj: 'art', dmg: 135, range: 12, minRange: 3, reload: 5.75, burst: 2, gap: 0.5, splash: 1.3, ground: true, air: false },
      queue: 'veh', producer: 'factory', req: ['factory', 'radar'],
    },
    mlrs: {
      key: 'mlrs', name: nato ? 'MARS II' : 'BM-21 Grad', role: 'Raketenartillerie',
      desc: 'Raketenwerfer: setzt ganze Flächen mit einer Salve unter Feuer, lädt lange nach. Leicht gepanzert.',
      cost: 1050, time: 16, hp: 260, armor: 'light', speed: 1.27, turn: 2.2, sight: 6, radius: 0.58,
      weapon: { cls: 'art', proj: 'mlrs', dmg: 49, range: 12.5, minRange: 3.5, reload: 7.5, burst: 8, gap: 0.17, splash: 1.1, ground: true, air: false },
      queue: 'veh', producer: 'factory', req: ['factory', 'radar'],
    },
    heli: {
      key: 'heli', name: nato ? 'AH-64 Apache' : 'Mi-24 Hind', role: 'Kampfhubschrauber', desc: 'Fliegt über alles hinweg. Raketen gegen Fahrzeuge und Schiffe.',
      cost: 1300, time: 15, hp: 390, armor: 'air', speed: 2.6, turn: 2.6, sight: 8, radius: 0.6,
      weapon: { cls: 'rocket', proj: 'rocket', dmg: 46, range: 5, reload: 2.2, burst: 2, gap: 0.2, ground: true, air: false },
      queue: 'air', producer: 'helipad', req: ['helipad'], air: true,
    },
    jet: {
      key: 'jet', name: nato ? 'Eurofighter' : 'Su-34', role: 'Kampfjet', desc: 'Startet vom Flugfeld zu einem Luftschlag auf ein Ziel und kehrt zum Aufmunitionieren zurück.',
      cost: 1500, time: 16, hp: 260, armor: 'air', speed: 7, turn: 2.6, sight: 7, radius: 0.55,
      weapon: { cls: 'missile', proj: 'missile', dmg: 92, range: 6, reload: 6, burst: 2, gap: 0.22, splash: 0.7, ground: true, air: false, sea: true },
      queue: 'air', producer: 'airfield', req: ['airfield'], air: true, jet: true,
    },
    boat: {
      key: 'boat', name: nato ? 'Schnellboot S143' : 'Raptor', role: 'Patrouillenboot', desc: 'Schnell und wendig, Maschinenkanone. Unterläuft die Raketen großer Schiffe, unterliegt aber Korvetten. Leicht gepanzert.',
      cost: 500, time: 7, hp: 260, armor: 'light', speed: 2.9, turn: 3, sight: 8, radius: 0.55,
      weapon: { cls: 'auto', proj: 'shell', dmg: 11, range: 5.5, reload: 0.9, burst: 4, gap: 0.08, ground: true, air: true },
      queue: 'sea', producer: 'shipyard', req: ['shipyard'], naval: true, hull: [nato ? 1.0 : 0.82, 0.31],
    },
    corvette: {
      key: 'corvette', name: nato ? 'Korvette K130' : 'Steregushchiy', role: 'Korvette', desc: 'Allrounder mit Schnellfeuerkanone gegen Schiffe, Ufer und Luft.',
      cost: 1000, time: 12, hp: 620, armor: 'ship', speed: 2.0, turn: 1.8, sight: 9, radius: 0.75,
      weapon: { cls: 'auto', proj: 'shell', dmg: 24, range: 7, reload: 1.6, burst: 3, gap: 0.2, ground: true, air: true },
      queue: 'sea', producer: 'shipyard', req: ['shipyard'], naval: true, hull: [1.38, 0.41],
    },
    destroyer: {
      key: 'destroyer', name: nato ? 'Arleigh Burke' : 'Slava-Kreuzer', role: nato ? 'Zerstörer' : 'Raketenkreuzer', desc: 'Marschflugkörper mit großer Reichweite gegen Ziele an Land und auf See.',
      cost: 1900, time: 18, hp: 1075, armor: 'ship', speed: 1.5, turn: 1.2, sight: 10, radius: 1.0,
      weapon: { cls: 'missile', proj: 'missile', dmg: 117, range: 13.5, minRange: 6, reload: 5.5, burst: 2, gap: 0.45, splash: 0.9, ground: true, air: false, sea: true },
      queue: 'sea', producer: 'shipyard', req: ['shipyard', 'radar'], naval: true, hull: [nato ? 1.88 : 1.94, 0.52],
    },
    lander: {
      key: 'lander', name: nato ? 'LCU 1700' : 'Ondatra', role: 'Landungsschiff', desc: 'Bringt bis zu 5 Bodeneinheiten über das Wasser. Einladen: Einheiten wählen, Rechtsklick aufs Schiff.',
      cost: 700, time: 9, hp: 520, armor: 'ship', speed: 1.9, turn: 2, sight: 6, radius: 0.8,
      queue: 'sea', producer: 'shipyard', req: ['shipyard'], naval: true, hull: [1.12, 0.47], transport: 5,
    },
    carrier: {
      key: 'carrier', name: nato ? 'Nimitz' : 'Admiral Kusnezow', role: 'Flugzeugträger', desc: 'Trägt drei eigene Jets, die selbstständig Ziele in weitem Umkreis angreifen. Flak zur Selbstverteidigung.',
      cost: 3200, time: 30, hp: 1900, armor: 'ship', speed: 1.1, turn: 0.8, sight: 11, radius: 1.5,
      weapon: { cls: 'flak', proj: 'flak', dmg: 12, range: 6, reload: 0.9, burst: 4, gap: 0.08, ground: false, air: true, sea: false },
      queue: 'sea', producer: 'shipyard', req: ['shipyard', 'airfield'], naval: true, hull: [2.62, 0.8], carrier: 3,
    },
  }
}

/** units prepared for the Godot version: models and values are exported, the browser game does not build them */
export function plannedUnitDefs(f: Faction): Record<string, UnitDef> {
  const nato = f === 'nato'
  return {
    mortar: {
      key: 'mortar', name: nato ? 'Mörsertrupp (120 mm)' : 'Mörsertrupp (2B11)', role: 'Mörsertrupp',
      desc: 'Leichte Artillerie der Infanterie: Steilfeuer über Häuser und Wälder, Flächenschaden gegen Infanterie und leichte Fahrzeuge. Nicht zu nah ans Ziel.',
      cost: 450, time: 9, hp: 60, armor: 'inf', speed: 0.65, turn: 0, sight: 6, radius: 0.22,
      weapon: { cls: 'art', proj: 'art', dmg: 75, range: 9, minRange: 2.5, reload: 3.6, splash: 1.2, ground: true, air: false },
      queue: 'inf', producer: 'barracks', req: ['barracks', 'radar'], infantry: true, planned: true,
    },
    medic: {
      key: 'medic', name: nato ? 'Sanitäter' : 'Sanitäter (Sanitar)', role: 'Sanitäter',
      desc: 'Heilt verwundete Soldaten in der Nähe. Ohne Waffe.',
      cost: 250, time: 6, hp: 60, armor: 'inf', speed: 0.9, turn: 0, sight: 6, radius: 0.2,
      queue: 'inf', producer: 'barracks', req: ['barracks'], infantry: true, heal: { rate: 6, range: 2.5 }, planned: true,
    },
  }
}
export const PLANNED_ORDER = ['mortar', 'medic']

export function buildingDefs(): Record<string, BuildingDef> {
  return {
    hq: { key: 'hq', name: 'Hauptquartier', desc: 'Baut alle Gebäude.', cost: 3000, time: 30, hp: 2200, w: 3, h: 3, power: 20, sight: 8, req: ['__never'], produces: 'build' },
    power: { key: 'power', name: 'Kraftwerk', desc: 'Liefert Strom. Ohne Strom läuft alles langsamer.', cost: 300, time: 6, hp: 650, w: 2, h: 2, power: 100, sight: 4, req: ['hq'] },
    ref: { key: 'ref', name: 'Rohstoffdepot', desc: 'Nimmt Erz an. Mit einem Erzlaster.', cost: 1600, time: 12, hp: 1100, w: 3, h: 3, power: -30, sight: 5, req: ['power'] },
    barracks: { key: 'barracks', name: 'Kaserne', desc: 'Bildet Infanterie aus.', cost: 400, time: 7, hp: 750, w: 2, h: 2, power: -20, sight: 5, req: ['power'], produces: 'inf' },
    factory: { key: 'factory', name: 'Fahrzeugwerk', desc: 'Baut Fahrzeuge.', cost: 1800, time: 14, hp: 1500, w: 3, h: 3, power: -30, sight: 5, req: ['ref'], produces: 'veh' },
    radar: { key: 'radar', name: 'Radarstation', desc: 'Schaltet Artillerie, Flak, Scharfschützen und Zerstörer frei. Große Sicht.', cost: 900, time: 10, hp: 900, w: 2, h: 2, power: -40, sight: 10, req: ['factory'] },
    shipyard: {
      key: 'shipyard', name: 'Werft', desc: 'Baut Schiffe. Muss am Ufer stehen, darf weiter von der Basis entfernt sein.', cost: 1200, time: 12, hp: 1300, w: 3, h: 3, power: -25, sight: 7,
      req: ['ref'], produces: 'sea', shore: true, reach: 14,
    },
    helipad: { key: 'helipad', name: 'Hubschrauberplatz', desc: 'Baut Kampfhubschrauber.', cost: 1200, time: 11, hp: 850, w: 2, h: 2, power: -20, sight: 5, req: ['radar'], produces: 'air' },
    airfield: { key: 'airfield', name: 'Flugfeld', desc: 'Baut Kampfjets und bietet drei Stellplätze zum Aufmunitionieren.', cost: 1800, time: 15, hp: 1300, w: 4, h: 3, power: -40, sight: 6, req: ['radar'], produces: 'air', slots: 3 },
    bunker: {
      key: 'bunker', name: 'MG-Bunker', desc: 'Verteidigung gegen Infanterie und leichte Fahrzeuge. Bis zu 3 Soldaten können einsteigen und mitschießen.', cost: 500, time: 7, hp: 800, w: 1, h: 1, power: -10, sight: 6,
      weapon: { cls: 'auto', proj: 'bullet', dmg: 15, range: 5.5, reload: 0.9, burst: 4, gap: 0.1, ground: true, air: false },
      req: ['barracks'], defense: true, garrison: 3,
    },
    rocket: {
      key: 'rocket', name: 'Raketenstellung', desc: 'Verteidigung gegen Panzer, Schiffe, Hubschrauber und Jets.', cost: 750, time: 9, hp: 600, w: 1, h: 1, power: -20, sight: 7,
      weapon: { cls: 'rocket', proj: 'rocket', dmg: 50, range: 7, reload: 2.4, burst: 2, gap: 0.25, ground: true, air: true },
      req: ['factory'], defense: true,
    },
  }
}

export const BUILD_ORDER = ['power', 'ref', 'barracks', 'factory', 'radar', 'shipyard', 'helipad', 'airfield', 'bunker', 'rocket']
export const UNIT_ORDER = ['rifle', 'at', 'sniper', 'engineer', 'harv', 'scout', 'ifv', 'mbt', 'aa', 'art', 'mlrs', 'heli', 'jet', 'boat', 'corvette', 'destroyer', 'lander', 'carrier']

/** shooting at something: does this weapon reach that kind of target */
export function reaches(w: WeaponDef, t: { air: boolean; naval: boolean }): boolean {
  return t.air ? w.air : t.naval ? w.sea ?? w.ground : w.ground
}

export const START_CREDITS = 5000
export const HARVEST_LOAD = 500
export const ORE_PER_TILE = 900
export const BUILD_RADIUS = 5
/** kills needed for each rank */
export const RANKS = [3, 7, 12]
export const RANK_NAME = ['Rekrut', 'Gefreiter', 'Feldwebel', 'Veteran']

/** the rules in numbers, as the game uses them (also written into the export for Godot) */
export const RULES = {
  startCredits: START_CREDITS,
  harvestLoad: HARVEST_LOAD,
  orePerTile: ORE_PER_TILE,
  mineAmount: 50,
  mineInterval: 0.5,
  unloadSeconds: 2.2,
  buildRadius: BUILD_RADIUS,
  sellRefund: 0.5,
  repairSeconds: 25,
  repairCostShare: 0.3,
  lowPowerProduction: 0.45,
  lowPowerDefenseRate: 0.5,
  extraProducerSpeed: 0.5,
  buildingRiseSeconds: 1.6,
  brokeTrickle: { perSecond: 8, below: 1000 },
  ranks: { kills: RANKS, names: RANK_NAME, damageBonus: 0.12, armorBonus: 0.07, promoteHeal: 0.25, veteranRegen: 0.01 },
  damageRandom: [0.9, 1.1],
  splashFalloff: 0.6,
  jetRearmSeconds: 6,
  carrierRebuildSeconds: 22,
  carrierStrikeRange: 17,
  sniperHideAfter: 2.5,
  sniperSpottedWithin: 2.2,
  aiDifficulty: { production: [0.8, 1, 1.25], income: [0.75, 1, 1.3] },
}
