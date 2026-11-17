# Pixelfront – Sprites für Godot

Erzeugt von export.html aus den Voxel-Modellen des Browser-Prototyps. Alles in **feinen Pixeln**
(pixelScale 2): ein Kartenfeld ist 64 × 32 Pixel groß.

## Aufbau

- `manifest.json` – beschreibt jede Datei: Zellgröße, Spalten, Zeilen, Ankerpunkt, Richtungen,
  Turm-Versatz je Richtung, Namen, Animationsregeln.
- `units/<fraktion>/<einheit>/` – `hull.png` (Rumpf bzw. stehender Soldat), `shadow.png`,
  `turret.png`, `hull2.png` (Ketten), `hull_anim_N.png` / `turret_anim_N.png` (Radar),
  `walk1.png`, `walk2.png`, `aim.png` (Infanterie), `alt.png` (beladener Erzlaster),
  `wreck.png`, `wreck_turret.png`, `icon.png` (Baumenü), `death_0…3.png` (Infanterie fällt),
  `turret_shadow.png` (Schatten des Turms). Mörsertrupp und Sanitäter sind als `planned` markiert.
- `buildings/<fraktion>/<gebäude>/` – `body.png`, `shadow.png`, `turret.png` (Abwehrstellungen), `icon.png`.
- `landscape/` – Bäume, Häuser, Kirche, Scheunen (je mit Schatten), Erz in drei Abbaustufen.
- `fx/` – Explosionen (4 Größen × 14 Bilder), Rauch, Ruß, Staub, Feuer, Brandflecken, Trümmer,
  Mündungsfeuer (3 Größen × 8 Richtungen × 2 Bilder).
- `terrain/tiles.png` – das Gelände als Kachelsatz (siehe unten).
- `deco/` – Zäune, Hecken, Autos, Traktor, Strommasten, Windrad (animiert), Heuballen, Kühe, Schafe,
  Wegkreuz, Sandsack-Stellungen, Panzersperren (je mit Schatten; Aufbau in `manifest.deco`).
- `ui/` – Befehls- und Touch-Symbole, Mauszeiger (mit Hotspot), Knöpfe in 4 Zuständen und ein Panel
  (Nine-Slice), Fahnen, Rangabzeichen; jeweils `@1x`, `@2x`, `@3x`. Dazu `ui/title.png` (Logo).
- `data/` – `units.json`, `buildings.json`, `damage.json`, `rules.json`: alle Werte und Regeln.
- `REGELWERK.md` – wie das Spiel rechnet, als Grundlage für die Portierung.

## Sheets

Jedes Sheet ist ein Raster gleich großer Zellen (`cellW` × `cellH`), `cols` Spalten,
`rows` Zeilen, `frames` Bilder, zeilenweise von links oben. In jeder Zelle liegt der
**Pivot** (der Punkt am Boden unter dem Objekt) bei (`anchorX`, `anchorY`).

Richtungssätze haben 32 Bilder (Infanterie 16): Bild i zeigt die Blickrichtung
`yaw = i / n * TAU`, wobei `yaw = atan2(dy, dx)` in Kartenkoordinaten ist.

## In Godot (4.x)

1. Ordner ins Projekt kopieren. Importeinstellungen: Filter **Nearest**, Kompression **Lossless**,
   Mipmaps aus (Projekt → Einstellungen → Rendering → Textures → Default Texture Filter: Nearest).
2. Sprite einrichten (Beispiel Rumpf):

```gdscript
func setup_sheet(spr: Sprite2D, sheet: Dictionary) -> void:
	spr.texture = load("res://pixelfront_sprites/" + sheet.file.trim_prefix("pixelfront_sprites/"))
	spr.hframes = sheet.cols
	spr.vframes = sheet.rows
	spr.centered = false
	spr.offset = Vector2(-sheet.anchorX, -sheet.anchorY)

func dir_index(yaw: float, n: int) -> int:
	return posmod(roundi(yaw / TAU * n), n)

# jedes Bild: spr.frame = dir_index(unit_yaw, n)
```

3. Position auf dem Bildschirm (in feinen Pixeln):
   `screen = Vector2((x - y) * 32, (x + y) * 16 - z * 2.5)` mit x, y in Feldern.
4. Turm: an `Rumpf-Position + mountOffsets[dir_index(rumpf_yaw, 32)]`, Bild nach der Turmrichtung.
5. Zeichenreihenfolge: nach `x + y` sortieren (y_sort mit der Bildschirm-y des Pivots passt ebenfalls).

Die Animationsregeln (Bilder pro Sekunde usw.) stehen in `manifest.json` unter `animation`.

## Gelände

`terrain/tiles.png` ist ein Atlas aus Rauten (64 × 32, 16 Spalten). `manifest.terrain.tiles` nennt zu
jedem Schlüssel Spalte und Zeile. In Godot: TileSet mit Form *Isometric*, Layout *Diamond Down*,
Kachelgröße 64 × 32, den Atlas als Quelle mit Regionsgröße 64 × 32. Der Kartengenerator (portiert aus
`map.ts`) wählt je Feld den Schlüssel so:

1. **Ufer:** `ist_wasser` = Wasser oder Brücke. Für die 8 Nachbarn in der Reihenfolge
   +x, −x, +y, −y, (+x+y), (−x+y), (+x−y), (−x−y) wird Bit 0…7 gesetzt, wenn der Nachbar auf der
   anderen Seite der Uferlinie liegt (Felder außerhalb der Karte zählen nicht). Dann die Ecken
   bereinigen: Bit 4 löschen, wenn Bit 0 oder 2 gesetzt ist; Bit 5 bei Bit 1 oder 2; Bit 6 bei
   Bit 0 oder 3; Bit 7 bei Bit 1 oder 3. Ist die Maske nicht 0:
   - Wasserfeld: `shore/water-sand/m<maske>`, wenn ein Nachbar Sand ist, sonst `shore/water-grass/m<maske>`
   - Sandfeld: `shore/sand/m<maske>`, jedes andere Landfeld: `shore/grass/m<maske>`
2. **Sonst nach Geländeart** (`v` = Variante, z. B. aus einem Hash der Feldkoordinaten):
   - Wiese: `grass/s<variant % 3>/h<hecke>/v<0…3>`
   - Acker: `field/c<variant & 7>/d<(variant >> 3) & 1>/h<hecke>/v<0…1>`
   - `forest/v<0…3>`, `dirt/v<0…3>`, `ore/v<0…3>` (Erzboden; die Erzbrocken sind Sprites), `sand/v<0…3>`
   - Wasser: `water/d1` (Tiefe < 3), `water/d3` (< 6), `water/d6`, jeweils `/v<0…3>`
   - Straße: am Boden wie eine Wiese (bzw. Ufer, Regel 1), dazu in einer **zweiten TileMap-Ebene** das
     Overlay `road/r<verbindungen>/v<0…1>` (durchsichtig bis auf den Asphalt; Bits wie `map.road`:
     1 = +x, 2 = −x, 4 = +y, 8 = −y)
   - Brücke: `bridge/r3` (entlang x) oder `bridge/r12` (entlang y)
3. **Hecke** (`h`): Bit 1, wenn das Feld bei −x zu einer anderen Parzelle gehört, Bit 2 bei −y.

Die Kacheln haben keine großflächigen Farbflecken, damit jede an jede passt. Wer die sanften
Farbwolken des Prototyps will, legt in Godot eine leichte Rausch-Textur (Modulate oder Shader) darüber.
