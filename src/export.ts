// Dev page (npm run dev → /export.html): renders every sprite of the game and packs them as PNG
// sprite sheets with a manifest into one ZIP, ready to be imported into another engine (Godot).
//
// Every sheet holds equally sized cells; each sprite sits in its cell so that its pivot (the
// point on the ground under it) is at the same place in every cell: (anchorX, anchorY).

import { buildAssets, mountOffset, type Assets } from './game/assets'
import type { Rot, Sprite } from './core/voxel'
import { SCALE, TW, TH, KZ, VOX_PER_TILE } from './core/iso'
import { UNIT_ORDER, BUILD_ORDER, unitDefs, buildingDefs } from './game/defs'
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
    },
    units: {} as Record<string, Record<string, unknown>>,
    buildings: {} as Record<string, Record<string, unknown>>,
  }
  for (const f of ['nato', 'ru'] as Faction[]) {
    const defs = unitDefs(f)
    const units: Record<string, unknown> = {}
    for (const key of UNIT_ORDER) {
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
        mountOffsets: art.turret ? Array.from({ length: 32 }, (_, i) => mountOffset(art.mount, (i / 32) * Math.PI * 2).map((v) => Math.round(v * 100) / 100)) : undefined,
        muzzle: art.muzzle,
        rotor: art.rotor,
        hull: d.hull,
        radius: d.radius,
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
  fx.note = 'smoke/soot/dust: Bild i = Größe i (wächst mit dem Aufsteigen); fire: Flackern im Kreis; scorch/rubble: Größen'
  manifest.fx = fx
  if (A.title) manifest.title = await sheet(`${R}ui/title.png`, [A.title])
  log('Effekte')
  files.push({ path: R + 'manifest.json', data: enc.encode(JSON.stringify(manifest, null, 1)) })
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
  \`wreck.png\`, \`wreck_turret.png\`, \`icon.png\` (Baumenü).
- \`buildings/<fraktion>/<gebäude>/\` – \`body.png\`, \`shadow.png\`, \`turret.png\` (Abwehrstellungen), \`icon.png\`.
- \`landscape/\` – Bäume, Häuser, Kirche, Scheunen (je mit Schatten), Erz in drei Abbaustufen.
- \`fx/\` – Explosionen (4 Größen × 14 Bilder), Rauch, Ruß, Staub, Feuer, Brandflecken, Trümmer.
- \`ui/title.png\` – das Logo.

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
  const A = await buildAssets((t, what) => (document.getElementById('bar')!.style.width = `${Math.round(t * 100)}%`, void what))
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
