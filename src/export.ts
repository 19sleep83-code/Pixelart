// Dev page (npm run dev → /export.html): renders every sprite of the game and packs them as PNG
// sprite sheets with a manifest into one ZIP, ready to be imported into another engine (Godot).
//
// Every sheet holds equally sized cells; each sprite sits in its cell so that its pivot (the
// point on the ground under it) is at the same place in every cell: (anchorX, anchorY).

import { buildAssets, mountOffset, type Assets } from './game/assets'
import type { Rot, Sprite } from './core/voxel'
import { SCALE, TW, TH, KZ, VOX_PER_TILE } from './core/iso'
import { UNIT_ORDER, BUILD_ORDER, PLANNED_ORDER, RULES, VS, ARMOR_NAME, unitDefs, plannedUnitDefs, buildingDefs, type UnitDef } from './game/defs'
import { GSPEC, COVER } from './game/game'
import REGELWERK from '../docs/REGELWERK.md?raw'
import { buildTiles } from './tiles'
import { DECO } from './game/deco'
import { fallen, lifted, muzzleFlash } from './anim'
import { ICONS, CURSORS, icon, cursor, button, panel, flag, rank, scaled } from './uiart'
import { Rot as RotSet, renderSprite, renderShadow } from './core/voxel'
import type { Faction } from './game/colors'

interface Sheet {
  file: string
  frames: number
  cols: number
  rows: number
  cellW: number
  cellH: number
  anchorX: number
  anchorY: number
}

const files: { path: string; data: Uint8Array }[] = []
const enc = new TextEncoder()

async function png(cv: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('toBlob'))), 'image/png'))
  return new Uint8Array(await blob.arrayBuffer())
}

/** packs sprites into a sheet of equal cells, pivots lined up */
async function sheet(path: string, sprites: Sprite[], cols = Math.min(8, sprites.length)): Promise<Sheet> {
  let L = 0, R = 0, U = 0, D = 0
  for (const s of sprites) {
    L = Math.max(L, s.ax)
    R = Math.max(R, s.w - s.ax)
    U = Math.max(U, s.ay)
    D = Math.max(D, s.h - s.ay)
  }
  const cellW = L + R, cellH = U + D
  const rows = Math.ceil(sprites.length / cols)
  const cv = document.createElement('canvas')
  cv.width = cellW * cols
  cv.height = cellH * rows
  const c = cv.getContext('2d')!
  sprites.forEach((s, i) => c.drawImage(s.cv, (i % cols) * cellW + L - s.ax, Math.floor(i / cols) * cellH + U - s.ay))
  files.push({ path, data: await png(cv) })
  return { file: path, frames: sprites.length, cols, rows, cellW, cellH, anchorX: L, anchorY: U }
}

async function rot(path: string, r: Rot): Promise<Sheet> {
  return sheet(path, r.sprites)
}

async function single(path: string, cv: HTMLCanvasElement): Promise<string> {
  files.push({ path, data: await png(cv) })
  return path
}

// ─────────────────────────────────────────────────────────── ZIP (stored, no compression: PNGs are packed already)

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
function crc32(d: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < d.length; i++) c = CRC[(c ^ d[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function zip(list: { path: string; data: Uint8Array }[]): Uint8Array<ArrayBuffer> {
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let off = 0
  for (const f of list) {
    const name = enc.encode(f.path)
    const crc = crc32(f.data)
    const h = new DataView(new ArrayBuffer(30))
    h.setUint32(0, 0x04034b50, true)
    h.setUint16(4, 20, true)
    h.setUint16(6, 0x0800, true) // UTF-8 names
    h.setUint16(8, 0, true)
    h.setUint32(14, crc, true)
    h.setUint32(18, f.data.length, true)
    h.setUint32(22, f.data.length, true)
    h.setUint16(26, name.length, true)
    parts.push(new Uint8Array(h.buffer), name, f.data)
    const c = new DataView(new ArrayBuffer(46))
    c.setUint32(0, 0x02014b50, true)
    c.setUint16(4, 20, true)
    c.setUint16(6, 20, true)
    c.setUint16(8, 0x0800, true)
    c.setUint32(16, crc, true)
    c.setUint32(20, f.data.length, true)
    c.setUint32(24, f.data.length, true)
    c.setUint16(28, name.length, true)
    c.setUint32(42, off, true)
    central.push(new Uint8Array(c.buffer), name)
    off += 30 + name.length + f.data.length
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0)
  const e = new DataView(new ArrayBuffer(22))
  e.setUint32(0, 0x06054b50, true)
  e.setUint16(8, list.length, true)
  e.setUint16(10, list.length, true)
  e.setUint32(12, cdSize, true)
  e.setUint32(16, off, true)
  const all = [...parts, ...central, new Uint8Array(e.buffer)]
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0))
  let p = 0
  for (const a of all) {
    out.set(a, p)
    p += a.length
  }
  return out
}

// ─────────────────────────────────────────────────────────── the export

async function exportAll(A: Assets, log: (s: string) => void) {
  const R = 'pixelfront_sprites/'
  const dirsOf = (r: Rot) => r.sprites.length
  const manifest: Record<string, unknown> = {
    version: 1,
    note: 'Siehe README.md. Alle Maße in Pixeln der Sprites (feine Pixel, pixelScale 2).',
    pixelScale: SCALE,
    tile: { w: TW, h: TH, voxelsPerTile: VOX_PER_TILE },
    heightPx: KZ,
    projection: 'screenX = (x - y) * tile.w / 2, screenY = (x + y) * tile.h / 2 - z * heightPx  (x, y in Feldern, z in Höheneinheiten)',
    directions: 'Sprite i eines Satzes mit n Richtungen zeigt die Blickrichtung yaw = i / n * 360°, yaw = atan2(dy, dx) in Kartenkoordinaten. Index: posmod(round(yaw / TAU * n), n)',
    animation: {
      infantry: 'gehen: walk1/walk2 im Wechsel, 7 Wechsel pro Sekunde; stehen: hull; feuern oder Ziel vorhanden: aim',
      tracks: 'hull2 (Ketten um ein Glied weiter) wechselt beim Fahren mit hull, 12 pro Sekunde',
      hullAnim: 'drehendes Radar usw.: Bilder 3 pro Sekunde im Kreis, ersetzt hull',
      turretAnim: 'drehendes Radar auf dem Turm: 4 Bilder pro Sekunde, ersetzt turret',
      harvester: 'alt = beladen',
      bob: 'Bodenfahrzeuge beim Fahren jedes zweite Bild 1 px höher (8 pro Sekunde); Schiffe: round(sin(t * 1.4) * 0.7) px',
      turret: 'Turm-Sprite nach Turmrichtung, gezeichnet an Rumpf-Pivot + mountOffsets[Rumpfrichtung]',
      shadow: 'Schatten unter dem Rumpf am Boden (z = 0); Luft: um z * 0.85 (Jets * 0.7) nach (0.035, 0.016) Feldern versetzt, Deckkraft 0.7',
      explosion: '14 Bilder über die Lebensdauer des Effekts verteilt',
      death: 'Infanterie: death_0…3 nacheinander (je etwa 0,12 s), dann death_3 liegen lassen oder ausblenden; Richtung wie hull',
      turretShadow: 'Turm-Schatten nach Turmrichtung, gezeichnet an Rumpf-Pivot + mountGroundOffsets[Rumpfrichtung], unter allen Rümpfen',
    },
    units: {} as Record<string, Record<string, unknown>>,
    buildings: {} as Record<string, Record<string, unknown>>,
  }
  for (const f of ['nato', 'ru'] as Faction[]) {
    const defs = { ...unitDefs(f), ...plannedUnitDefs(f) }
    const units: Record<string, unknown> = {}
    for (const key of [...UNIT_ORDER, ...PLANNED_ORDER]) {
      const art = A.units[f][key]
      const p = `${R}units/${f}/${key}/`
      const n = dirsOf(art.hull)
      const sheets: Record<string, unknown> = {}
      sheets.hull = await rot(p + 'hull.png', art.hull)
      if (art.hull.shadows.length) sheets.shadow = await sheet(p + 'shadow.png', art.hull.shadows)
      const inf = defs[key].infantry
      if (art.alt) sheets[inf ? 'walk1' : 'alt'] = await rot(p + (inf ? 'walk1.png' : 'alt.png'), art.alt)
      if (art.alt2) sheets.walk2 = await rot(p + 'walk2.png', art.alt2)
      if (art.aim) sheets.aim = await rot(p + 'aim.png', art.aim)
      if (art.hull2) sheets.hull2 = await rot(p + 'hull2.png', art.hull2)
      if (art.hullAnim) sheets.hullAnim = await Promise.all(art.hullAnim.map((r, i) => rot(`${p}hull_anim_${i}.png`, r)))
      if (art.turret) sheets.turret = await rot(p + 'turret.png', art.turret)
      if (art.turretAnim) sheets.turretAnim = await Promise.all(art.turretAnim.map((r, i) => rot(`${p}turret_anim_${i}.png`, r)))
      if (inf) {
        // falling over backwards: four frames, the last one lying flat
        sheets.death = await Promise.all([0.45, 0.95, 1.35, Math.PI / 2].map((a, i) => rot(`${p}death_${i}.png`, new RotSet(fallen(art.hull.m, a), n, {}, false))))
      }
      if (art.turret) {
        // the turret's shadow, cast from the height it sits at
        const tm = lifted(art.turret.m, art.mount[2])
        sheets.turretShadow = await sheet(p + 'turret_shadow.png', Array.from({ length: 32 }, (_, i) => renderShadow(tm, (i / 32) * Math.PI * 2)))
      }
      if (art.wreck) sheets.wreck = await rot(p + 'wreck.png', art.wreck)
      if (art.wreckTurret) sheets.wreckTurret = await rot(p + 'wreck_turret.png', art.wreckTurret)
      const d = defs[key]
      units[key] = {
        name: d.name,
        role: d.role,
        directions: n,
        sheets,
        icon: await single(p + 'icon.png', art.icon),
        mount: art.mount,
        mountGroundOffsets: art.turret ? Array.from({ length: 32 }, (_, i) => mountOffset([art.mount[0], art.mount[1], 0], (i / 32) * Math.PI * 2).map((v) => Math.round(v * 100) / 100)) : undefined,
        mountOffsets: art.turret ? Array.from({ length: 32 }, (_, i) => mountOffset(art.mount, (i / 32) * Math.PI * 2).map((v) => Math.round(v * 100) / 100)) : undefined,
        muzzle: art.muzzle,
        rotor: art.rotor,
        hull: d.hull,
        radius: d.radius,
        planned: d.planned,
      }
      log(`Einheit ${f}/${key}`)
    }
    ;(manifest.units as Record<string, unknown>)[f] = units
    const bdefs = buildingDefs()
    const blds: Record<string, unknown> = {}
    for (const key of ['hq', ...BUILD_ORDER]) {
      const art = A.buildings[f][key]
      const p = `${R}buildings/${f}/${key}/`
      const sheets: Record<string, unknown> = {
        body: await sheet(p + 'body.png', [art.body]),
        shadow: await sheet(p + 'shadow.png', [art.shadow]),
      }
      if (art.turret) sheets.turret = await rot(p + 'turret.png', art.turret)
      blds[key] = {
        name: bdefs[key].name,
        footprint: [bdefs[key].w, bdefs[key].h],
        pivot: 'Mitte der Grundfläche',
        sheets,
        icon: await single(p + 'icon.png', art.icon),
        mount: art.mount,
        mountOffset: art.turret ? mountOffset(art.mount, 0) : undefined,
      }
      log(`Gebäude ${f}/${key}`)
    }
    ;(manifest.buildings as Record<string, unknown>)[f] = blds
  }
  const statics: Record<string, unknown> = {}
  for (const [kind, list] of Object.entries(A.statics)) {
    statics[kind] = await Promise.all(
      list.map(async (s, i) => ({
        sprite: await sheet(`${R}landscape/${kind}_${i}.png`, [s.sp]),
        shadow: await sheet(`${R}landscape/${kind}_${i}_shadow.png`, [s.sh]),
      })),
    )
  }
  manifest.landscape = statics
  manifest.ore = await Promise.all(A.ore.map((stage, st) => sheet(`${R}landscape/ore_stage${st}.png`, stage, stage.length)))
  log('Landschaft')
  const fx: Record<string, unknown> = {}
  fx.explosion = await Promise.all(A.explosions.map((fr, i) => sheet(`${R}fx/explosion_${i}.png`, fr, fr.length)))
  fx.smoke = await sheet(`${R}fx/smoke.png`, A.smoke, A.smoke.length)
  fx.soot = await sheet(`${R}fx/soot.png`, A.soot, 7)
  fx.dust = await sheet(`${R}fx/dust.png`, A.dust, A.dust.length)
  fx.fire = await sheet(`${R}fx/fire.png`, A.fire, A.fire.length)
  fx.scorch = await sheet(`${R}fx/scorch.png`, A.scorch, A.scorch.length)
  fx.rubble = await sheet(`${R}fx/rubble.png`, A.rubble, A.rubble.length)
  fx.muzzle = await Promise.all(
    [0, 1, 2].map((sz) =>
      sheet(`${R}fx/muzzle_${['rifle', 'cannon', 'howitzer'][sz]}.png`, Array.from({ length: 16 }, (_, i) => muzzleFlash(sz, ((i >> 1) / 8) * Math.PI * 2, i & 1)), 8),
    ),
  )
  fx.muzzleNote = 'Mündungsfeuer 0 Gewehr, 1 Kanone, 2 Haubitze: Bild 2·r + f, r = Richtung 0…7 (wie dir_index mit n = 8), f = Flackerbild 0/1; Mitte = Mündung'
  fx.note = 'smoke/soot/dust: Bild i = Größe i (wächst mit dem Aufsteigen); fire: Flackern im Kreis; scorch/rubble: Größen'
  manifest.fx = fx
  // life on the map (only for the next version)
  const deco: Record<string, unknown> = {}
  for (const d of DECO) {
    const vars: unknown[] = []
    for (let v = 0; v < d.variants; v++) {
      const base = `${R}deco/${d.key}_v${v}`
      if (d.dirs > 2) {
        const frames: unknown[] = []
        for (let f = 0; f < d.frames; f++) {
          const r = new RotSet(d.make(v, f), d.dirs)
          const suf = d.frames > 1 ? `_f${f}` : ''
          frames.push({ sprite: await rot(`${base}${suf}.png`, r), shadow: await sheet(`${base}${suf}_shadow.png`, r.shadows) })
        }
        vars.push(frames)
      } else {
        // one heading (frames side by side), or two: along x (yaw 0) and along y (yaw 90°)
        const yaws = d.dirs === 2 ? [0, Math.PI / 2] : [0]
        const sps = [], shs = []
        for (const yaw of yaws)
          for (let f = 0; f < d.frames; f++) {
            const mdl = d.make(v, f)
            sps.push(renderSprite(mdl, yaw))
            shs.push(renderShadow(mdl, yaw, 0.3))
          }
        vars.push({ sprite: await sheet(`${base}.png`, sps), shadow: await sheet(`${base}_shadow.png`, shs) })
      }
    }
    deco[d.key] = { name: d.name, dirs: d.dirs, variants: d.variants, frames: d.frames, frameNote: d.frameNote, sheets: vars }
  }
  manifest.deco = {
    note: 'dirs 8: je Variante und Bild ein Sheet mit 8 Richtungen; dirs 2: Bild 0 entlang x, Bild 1 entlang y; dirs 1: Animationsbilder nebeneinander',
    items: deco,
  }
  log('Deko')
  // the interface: every picture at ×1, ×2 and ×3
  const ui: Record<string, unknown> = { scales: [1, 2, 3], note: 'Datei <name>@<k>x.png; Hotspot und Nine-Slice-Rand gelten für ×1 und werden mitskaliert' }
  const three = async (path: string, cv: HTMLCanvasElement) => {
    for (const k of [1, 2, 3]) await single(`${R}ui/${path}@${k}x.png`, scaled(cv, k))
    return `ui/${path}`
  }
  ui.icons = Object.fromEntries(await Promise.all(Object.entries(ICONS).map(async ([k, v]) => [k, { name: v.name, file: await three(`icons/${k}`, icon(k)) }])))
  ui.cursors = Object.fromEntries(await Promise.all(Object.entries(CURSORS).map(async ([k, v]) => [k, { name: v.name, hotspot: v.hot, file: await three(`cursors/${k}`, cursor(k)) }])))
  ui.buttons = { nineSliceMargin: 6, states: Object.fromEntries(await Promise.all((['normal', 'hover', 'pressed', 'disabled'] as const).map(async (st) => [st, await three(`button_${st}`, button(st))]))) }
  ui.panel = { nineSliceMargin: 8, file: await three('panel', panel()) }
  ui.flags = { nato: await three('flag_nato', flag('nato')), ru: await three('flag_ru', flag('ru')) }
  ui.ranks = { note: 'Gefreiter, Feldwebel, Veteran (Rekrut ohne Abzeichen)', files: [await three('rank_1', rank(1)), await three('rank_2', rank(2)), await three('rank_3', rank(3))] }
  manifest.ui = ui
  log('Oberfläche')
  if (A.title) manifest.title = await sheet(`${R}ui/title.png`, [A.title])
  log('Effekte')
  const T = buildTiles()
  manifest.terrain = {
    atlas: await single(`${R}terrain/tiles.png`, T.atlas),
    tileW: TW,
    tileH: TH,
    cols: T.cols,
    note: 'Rauten 64 × 32, Zelle (col, row) im Atlas. Auswahl siehe README, Abschnitt Gelände.',
    tiles: T.tiles,
  }
  log(`Gelände: ${T.tiles.length} Kacheln`)
  files.push({ path: R + 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 1)) })
  // the values and rules: the same for both sides, only the names differ
  const json = (name: string, v: unknown) => files.push({ path: `${R}data/${name}`, data: enc.encode(JSON.stringify(v, null, 1)) })
  const strip = (d: UnitDef) => {
    const { name: _n, role: _r, ...rest } = d
    void _n
    void _r
    return rest
  }
  const all = (f: Faction) => ({ ...unitDefs(f), ...plannedUnitDefs(f) })
  const keys = [...UNIT_ORDER, ...PLANNED_ORDER]
  json('units.json', {
    note: 'Werte gelten für beide Fraktionen; Namen und Rollenbezeichnung je Fraktion unter names. planned = nur für Godot vorbereitet.',
    order: UNIT_ORDER,
    planned: PLANNED_ORDER,
    units: Object.fromEntries(keys.map((k) => [k, strip(all('nato')[k])])),
    names: Object.fromEntries((['nato', 'ru'] as Faction[]).map((f) => [f, Object.fromEntries(keys.map((k) => [k, { name: all(f)[k].name, role: all(f)[k].role }]))])),
    hullPerFaction: Object.fromEntries((['nato', 'ru'] as Faction[]).map((f) => [f, Object.fromEntries(keys.filter((k) => all(f)[k].hull).map((k) => [k, all(f)[k].hull]))])),
  })
  json('buildings.json', { order: ['hq', ...BUILD_ORDER], buildings: buildingDefs() })
  json('damage.json', { note: 'Schaden = Waffe × table[Waffenart][Panzerung]', table: VS, armorNames: ARMOR_NAME })
  json('rules.json', { ...RULES, garrison: GSPEC, cover: COVER })
  files.push({ path: R + 'REGELWERK.md', data: enc.encode(REGELWERK) })
  files.push({ path: R + 'README.md', data: enc.encode(README) })
}

const README = `# Pixelfront – Sprites für Godot

Erzeugt von export.html aus den Voxel-Modellen des Browser-Prototyps. Alles in **feinen Pixeln**
(pixelScale 2): ein Kartenfeld ist 64 × 32 Pixel groß.

## Aufbau

- \`manifest.json\` – beschreibt jede Datei: Zellgröße, Spalten, Zeilen, Ankerpunkt, Richtungen,
  Turm-Versatz je Richtung, Namen, Animationsregeln.
- \`units/<fraktion>/<einheit>/\` – \`hull.png\` (Rumpf bzw. stehender Soldat), \`shadow.png\`,
  \`turret.png\`, \`hull2.png\` (Ketten), \`hull_anim_N.png\` / \`turret_anim_N.png\` (Radar),
  \`walk1.png\`, \`walk2.png\`, \`aim.png\` (Infanterie), \`alt.png\` (beladener Erzlaster),
  \`wreck.png\`, \`wreck_turret.png\`, \`icon.png\` (Baumenü), \`death_0…3.png\` (Infanterie fällt),
  \`turret_shadow.png\` (Schatten des Turms). Mörsertrupp und Sanitäter sind als \`planned\` markiert.
- \`buildings/<fraktion>/<gebäude>/\` – \`body.png\`, \`shadow.png\`, \`turret.png\` (Abwehrstellungen), \`icon.png\`.
- \`landscape/\` – Bäume, Häuser, Kirche, Scheunen (je mit Schatten), Erz in drei Abbaustufen.
- \`fx/\` – Explosionen (4 Größen × 14 Bilder), Rauch, Ruß, Staub, Feuer, Brandflecken, Trümmer,
  Mündungsfeuer (3 Größen × 8 Richtungen × 2 Bilder).
- \`terrain/tiles.png\` – das Gelände als Kachelsatz (siehe unten).
- \`deco/\` – Zäune, Hecken, Autos, Traktor, Strommasten, Windrad (animiert), Heuballen, Kühe, Schafe,
  Wegkreuz, Sandsack-Stellungen, Panzersperren (je mit Schatten; Aufbau in \`manifest.deco\`).
- \`ui/\` – Befehls- und Touch-Symbole, Mauszeiger (mit Hotspot), Knöpfe in 4 Zuständen und ein Panel
  (Nine-Slice), Fahnen, Rangabzeichen; jeweils \`@1x\`, \`@2x\`, \`@3x\`. Dazu \`ui/title.png\` (Logo).
- \`data/\` – \`units.json\`, \`buildings.json\`, \`damage.json\`, \`rules.json\`: alle Werte und Regeln.
- \`REGELWERK.md\` – wie das Spiel rechnet, als Grundlage für die Portierung.

## Sheets

Jedes Sheet ist ein Raster gleich großer Zellen (\`cellW\` × \`cellH\`), \`cols\` Spalten,
\`rows\` Zeilen, \`frames\` Bilder, zeilenweise von links oben. In jeder Zelle liegt der
**Pivot** (der Punkt am Boden unter dem Objekt) bei (\`anchorX\`, \`anchorY\`).

Richtungssätze haben 32 Bilder (Infanterie 16): Bild i zeigt die Blickrichtung
\`yaw = i / n * TAU\`, wobei \`yaw = atan2(dy, dx)\` in Kartenkoordinaten ist.

## In Godot (4.x)

1. Ordner ins Projekt kopieren. Importeinstellungen: Filter **Nearest**, Kompression **Lossless**,
   Mipmaps aus (Projekt → Einstellungen → Rendering → Textures → Default Texture Filter: Nearest).
2. Sprite einrichten (Beispiel Rumpf):

\`\`\`gdscript
func setup_sheet(spr: Sprite2D, sheet: Dictionary) -> void:
	spr.texture = load("res://pixelfront_sprites/" + sheet.file.trim_prefix("pixelfront_sprites/"))
	spr.hframes = sheet.cols
	spr.vframes = sheet.rows
	spr.centered = false
	spr.offset = Vector2(-sheet.anchorX, -sheet.anchorY)

func dir_index(yaw: float, n: int) -> int:
	return posmod(roundi(yaw / TAU * n), n)

# jedes Bild: spr.frame = dir_index(unit_yaw, n)
\`\`\`

3. Position auf dem Bildschirm (in feinen Pixeln):
   \`screen = Vector2((x - y) * 32, (x + y) * 16 - z * 2.5)\` mit x, y in Feldern.
4. Turm: an \`Rumpf-Position + mountOffsets[dir_index(rumpf_yaw, 32)]\`, Bild nach der Turmrichtung.
5. Zeichenreihenfolge: nach \`x + y\` sortieren (y_sort mit der Bildschirm-y des Pivots passt ebenfalls).

Die Animationsregeln (Bilder pro Sekunde usw.) stehen in \`manifest.json\` unter \`animation\`.

## Gelände

\`terrain/tiles.png\` ist ein Atlas aus Rauten (64 × 32, 16 Spalten). \`manifest.terrain.tiles\` nennt zu
jedem Schlüssel Spalte und Zeile. In Godot: TileSet mit Form *Isometric*, Layout *Diamond Down*,
Kachelgröße 64 × 32, den Atlas als Quelle mit Regionsgröße 64 × 32. Der Kartengenerator (portiert aus
\`map.ts\`) wählt je Feld den Schlüssel so:

1. **Ufer:** \`ist_wasser\` = Wasser oder Brücke. Für die 8 Nachbarn in der Reihenfolge
   +x, −x, +y, −y, (+x+y), (−x+y), (+x−y), (−x−y) wird Bit 0…7 gesetzt, wenn der Nachbar auf der
   anderen Seite der Uferlinie liegt (Felder außerhalb der Karte zählen nicht). Dann die Ecken
   bereinigen: Bit 4 löschen, wenn Bit 0 oder 2 gesetzt ist; Bit 5 bei Bit 1 oder 2; Bit 6 bei
   Bit 0 oder 3; Bit 7 bei Bit 1 oder 3. Ist die Maske nicht 0:
   - Wasserfeld: \`shore/water-sand/m<maske>\`, wenn ein Nachbar Sand ist, sonst \`shore/water-grass/m<maske>\`
   - Sandfeld: \`shore/sand/m<maske>\`, jedes andere Landfeld: \`shore/grass/m<maske>\`
2. **Sonst nach Geländeart** (\`v\` = Variante, z. B. aus einem Hash der Feldkoordinaten):
   - Wiese: \`grass/s<variant % 3>/h<hecke>/v<0…3>\`
   - Acker: \`field/c<variant & 7>/d<(variant >> 3) & 1>/h<hecke>/v<0…1>\`
   - \`forest/v<0…3>\`, \`dirt/v<0…3>\`, \`ore/v<0…3>\` (Erzboden; die Erzbrocken sind Sprites), \`sand/v<0…3>\`
   - Wasser: \`water/d1\` (Tiefe < 3), \`water/d3\` (< 6), \`water/d6\`, jeweils \`/v<0…3>\`
   - Straße: am Boden wie eine Wiese (bzw. Ufer, Regel 1), dazu in einer **zweiten TileMap-Ebene** das
     Overlay \`road/r<verbindungen>/v<0…1>\` (durchsichtig bis auf den Asphalt; Bits wie \`map.road\`:
     1 = +x, 2 = −x, 4 = +y, 8 = −y)
   - Brücke: \`bridge/r3\` (entlang x) oder \`bridge/r12\` (entlang y)
3. **Hecke** (\`h\`): Bit 1, wenn das Feld bei −x zu einer anderen Parzelle gehört, Bit 2 bei −y.

Die Kacheln haben keine großflächigen Farbflecken, damit jede an jede passt. Wer die sanften
Farbwolken des Prototyps will, legt in Godot eine leichte Rausch-Textur (Modulate oder Shader) darüber.
`

// ─────────────────────────────────────────────────────────── the page

const out = document.getElementById('log')!
const btn = document.getElementById('dl') as HTMLAnchorElement
const log = (s: string) => {
  out.textContent += s + '\n'
  out.scrollTop = out.scrollHeight
}
;(async () => {
  log('Erzeuge Grafik aus den Voxel-Modellen …')
  const A = await buildAssets((t, what) => (document.getElementById('bar')!.style.width = `${Math.round(t * 100)}%`, void what), PLANNED_ORDER)
  log('Packe Sprite-Sheets …')
  await exportAll(A, log)
  const data = zip(files)
  const url = URL.createObjectURL(new Blob([data as Uint8Array<ArrayBuffer>], { type: 'application/zip' }))
  btn.href = url
  btn.download = 'pixelfront_sprites.zip'
  btn.classList.remove('hidden')
  const mb = (data.length / 1048576).toFixed(1)
  log(`Fertig: ${files.length} Dateien, ${mb} MB`)
  ;(window as unknown as { __export: { files: number; bytes: number } }).__export = { files: files.length, bytes: data.length }
})().catch((e) => log('FEHLER: ' + (e as Error).message))
