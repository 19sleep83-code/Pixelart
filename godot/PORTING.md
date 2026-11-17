# Portierung TypeScript → GDScript (Godot 4.7)

Regeln, damit alle Teile zusammenpassen.

## Grundsätze

- **1:1-Übertragung** der Logik aus `src/` (TypeScript-Prototyp). Gleiche Algorithmen, gleiche Zahlen,
  gleiche Reihenfolge von Zufallszahlen, damit gleiche Startwerte gleiche Karten und gleiches Verhalten ergeben.
- **Namen:** Felder und Funktionen in `snake_case` aus den TS-Namen (`tileStatics` → `tile_statics`,
  `navI` → `nav_i`, `commandMove` → `command_move`). Klassen `PascalCase` mit `class_name`.
- **Schlüssel in Dictionaries aus den JSON-Daten bleiben wie im JSON** (camelCase: `minRange`, `produces`).
- **Typen:** statisch typisiert wo möglich. Arrays großer Karten als `PackedByteArray` / `PackedInt32Array` /
  `PackedFloat32Array` (dort, wo TS `Float32Array` nutzt, damit die Rundung gleich ist).
- **Ganzzahl-Arithmetik:** JS `Math.imul`, `>>> 0`, `| 0` exakt nachbilden (32-Bit), siehe `scripts/core/rng.gd`.
- **Einrückung mit Tabs.** Kommentare auf Englisch wie im Prototyp, Texte für Spieler auf Deutsch.

## Dateien

| TS | GDScript | Klasse |
| --- | --- | --- |
| `src/core/rng.ts` | `scripts/core/rng.gd` | `Rng` (statische Funktionen, `Rng.Mulberry` als Generator) |
| `src/game/map.ts` | `scripts/game/map.gd` | `GameMap` (+ `static func generate(seed, type)`) |
| `src/game/path.ts` | `scripts/game/path.gd` | `PathFinder` |
| `src/game/defs.ts` | `scripts/data.gd` (Autoload `Data`) | Werte kommen aus `assets/sprites/data/*.json` |
| `src/game/game.ts` | `scripts/game/game.gd`, `scripts/game/ent.gd` | `Game`, `Ent` |
| `src/game/ai.ts` | `scripts/game/ai.gd` | `AI` |
| `src/game/render.ts`, `terrain.ts`, `atmos.ts` | `scripts/view/*.gd` | `World`, … |
| `src/game/input.ts`, `src/ui/hud.ts` | `scripts/view/input.gd`, `scripts/ui/hud.gd` | |
| `src/main.ts` | `scripts/main.gd` | |

## Schnittstellen

**GameMap**: `N`, `seed`, `type` (`"land"|"coast"|"lakes"`), `ter`, `variant`, `road`, `block`, `depth`
(`PackedByteArray`), `parcel`, `ore`, `bld` (`PackedInt32Array`), `statics` (Array von Dictionaries
`{kind, v, x, y}`), `tile_statics` (Array, je Feld `null` oder Array von Statics), `starts` (Array von
`Vector2i`); Methoden `idx(x, y)`, `in_map(x, y)`, `walk(x, y)`, `walk_i(i)`, `nav(x, y)`, `nav_i(i)`,
`buildable(x, y)`, `add_static(s)`, `measure_depth()`. Geländearten als Konstanten `GameMap.GRASS` … `GameMap.SAND`
(Werte wie `Ter` im Prototyp: Grass 0, Field 1, Forest 2, Water 3, Road 4, Ore 5, Bridge 6, Dirt 7, Sand 8).

**PathFinder**: `PathFinder.new(map, pass: Callable = Callable())` (ohne `pass`: begehbar zu Land);
`ok(x, y)`, `nearest_walkable(x, y, max_r := 12) -> Vector2i` (`Vector2i(-1, -1)` wenn keins),
`find(sx, sy, gx, gy, max_nodes := 6000) -> PackedInt32Array` (Feld-Indizes wie im TS).

## Tests

Godot: `/tmp/claude-0/-home-user-Pixelart/3bb0c800-0ee2-564d-80a3-1ee820e0ddef/scratchpad/godot_bin/Godot_v4.7.2-stable_linux.x86_64`
(nur in dieser Entwicklungsumgebung; auf dem PC das normale Godot 4.7).

- **Tests mit Autoloads (Data, Sound):** Skript `godot/tests/<name>.gd`, `extends Node`, mit
  `func run(args: PackedStringArray) -> void` (darf `await`), gestartet über die Testszene:
  `godot --headless --path godot res://tests/runner.tscn -- <name> [args …]`.
  (Unter `-s` kennt GDScript die Autoload-Namen nicht; dort nur Skripte ohne `Data`/`Sound`, Arbeit im ersten
  `_process`, nie `quit()` in `_initialize`.)
- Wegen `pass` als Schlüsselwort heißt der Parameter des PathFinders `pass_` (Feld `pass_fn`).
  Distanzen wie im Prototyp mit `Rng.hypot` (V8-genau), Rundung wie JS mit `Rng.js_round`.
- Gleichheit mit dem Prototyp prüfen: TS-Seite mit `node_modules/.bin/esbuild <datei.ts> --bundle
  --platform=node` bauen und dieselben Prüfsummen ausgeben.
- Bilder: `xvfb-run -a godot --path godot --rendering-driver opengl3 …` und im Skript
  `get_viewport().get_texture().get_image().save_png(...)`.
