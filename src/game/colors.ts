// The palette: a muted Central European landscape, two armies and the things in between.
import { hex } from '../core/iso'

export type Faction = 'nato' | 'ru'

export interface Scheme {
  base: number
  camo2: number
  camo3: number
  dark: number
  team: number
  teamDark: number
  teamLight: number
  metal: number
  track: number
  glass: number
  uniform: number
  uniform2: number
  helmet: number
  name: string
  short: string
}

export const SCHEMES: Record<Faction, Scheme> = {
  nato: {
    base: hex('4c5934'),
    camo2: hex('3a3f29'),
    camo3: hex('5f4b33'),
    dark: hex('2f3424'),
    team: hex('3d74d8'),
    teamDark: hex('234a9a'),
    teamLight: hex('8fb4ff'),
    metal: hex('3a3d3c'),
    track: hex('2b2a27'),
    glass: hex('5d9ab4'),
    uniform: hex('56603c'),
    uniform2: hex('3e452c'),
    helmet: hex('454d32'),
    name: 'NATO',
    short: 'NATO',
  },
  ru: {
    base: hex('5d6e3a'),
    camo2: hex('7a7a4c'),
    camo3: hex('3f4a2a'),
    dark: hex('343d24'),
    team: hex('d23a2c'),
    teamDark: hex('8e2119'),
    teamLight: hex('ff9a86'),
    metal: hex('3b3d38'),
    track: hex('2c2b26'),
    glass: hex('6a9aa6'),
    uniform: hex('6b7046'),
    uniform2: hex('4b5133'),
    helmet: hex('55603a'),
    name: 'Russland',
    short: 'RUS',
  },
}

export const COL = {
  skin: hex('d6a47c'),
  black: hex('1d1f1c'),
  white: hex('ecebe2'),
  concrete: hex('a9a79c'),
  concrete2: hex('918f85'),
  concrete3: hex('c4c2b6'),
  asphalt: hex('5c5d5a'),
  steel: hex('7d8486'),
  steelDark: hex('4f5557'),
  rust: hex('8a4a2c'),
  brick: hex('9a4a34'),
  brickDark: hex('7b3a29'),
  roof: hex('a9452e'),
  roof2: hex('8a3626'),
  roofDark: hex('5d4a44'),
  copper: hex('5e8f7a'),
  wall: hex('e4d9bb'),
  wall2: hex('d5c7a2'),
  timber: hex('5a3f2b'),
  window: hex('34495a'),
  windowLit: hex('f3d98c'),
  wood: hex('7a5a3a'),
  wood2: hex('5f4630'),
  sand: hex('b9a77a'),
  sandbag: hex('a8986c'),
  yellow: hex('e0b532'),
  hazard: hex('d9a92a'),
  green: hex('4f8a3a'),
  leaf1: hex('3d6a2a'),
  leaf2: hex('4e7d31'),
  leaf3: hex('5f8f37'),
  leaf4: hex('6f9a3c'),
  autumn: hex('9a7a2e'),
  pine1: hex('2c4c30'),
  pine2: hex('355a37'),
  pine3: hex('42683f'),
  trunk: hex('5a4030'),
  rock: hex('7d766a'),
  rock2: hex('635d53'),
  rock3: hex('969082'),
  ore: hex('d0a23a'),
  ore2: hex('b8642e'),
  ore3: hex('f0d27a'),
  hay: hex('d7bc62'),
  water: hex('3e6b84'),
  glass: hex('7fb4c8'),
}
