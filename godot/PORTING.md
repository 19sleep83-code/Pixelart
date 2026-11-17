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

## Game-API

Simulation: `scripts/game/game.gd` (`Game`, RefCounted), `scripts/game/ent.gd` (`Ent`), `scripts/game/ai.gd` (`AI`).
Namen wie im Prototyp in `snake_case`. Fehlende Werte sind `null` (Punkte als `Vector2`, Verweise als `Ent` /
`Game.Garrison`). Zustände sind Strings wie im TS (`order`, `hs`, `js`, `kind` …). Def-Dictionaries aus `Data`
behalten camelCase (`e.u["minRange"]`, `e.u.weapon.burst`).

```gdscript
var g := Game.new({"seed": 1, "faction": "nato", "difficulty": 1, "mapType": "land", "tod": "day", "weather": "clear"})
var ai := AI.new(g)            # Spieler 1; für KI gegen KI: a0 := AI.new(g); a0.p = 0; g.players[0].ai = true
g.on_sound = func(ev: String, x: float, y: float) -> void: Sound.play(ev, x, y)
# je Tick (Prototyp: 30 Hz):  g.update(dt); ai.update(dt)
g.dispose()                    # beim Verwerfen einer Schlacht (löst Ringverweise), danach unbenutzbar
```

### Game – Felder

| Feld | Typ | |
| --- | --- | --- |
| `opts` | `Dictionary` | `seed, faction, difficulty, mapType, tod, weather` (mit Vorgaben ergänzt) |
| `map` | `GameMap` | |
| `pf`, `npf` | `PathFinder` | an Land / auf dem Wasser |
| `ents` | `Array[Ent]` | lebende Einheiten und Gebäude (Tote fallen am Tick-Ende heraus) |
| `by_id` | `Dictionary` | `int -> Ent` (nur lebende) |
| `players` | `Array[Game.Player]` | 0 = Mensch, 1 = Computer |
| `me` | `Game.Player` | Getter: `players[0]` |
| `bdefs` | `Dictionary` | `Data.building_defs()` |
| `shots` | `Array[Game.Shot]` | Geschosse im Flug |
| `fx` | `Array[Game.Fx]` | Effekte; abgelaufene Fx-Objekte werden wiederverwendet – nicht über Ticks hinweg festhalten |
| `wrecks` | `Array[Game.Wreck]` | |
| `msgs` | `Array[Game.Msg]` | höchstens 6 |
| `time` | `float` | Sekunden |
| `rand` | `Rng.Mulberry` | `mulberry32(12345)`, auch von der KI benutzt |
| `fog` | `PackedByteArray` | `N*N`, 0 nie gesehen, 1 gesehen, 2 in Sicht (Spieler 0); alle 0,2 s neu |
| `fog_dirty` | `bool` | Renderer setzt auf `false` |
| `over` | `int` | 0 läuft, 1 Spieler 0 gewinnt, -1 verliert |
| `stamps` | `Array[Game.Stamp]` | Bodenmarken; Renderer malt und leert (`stamps.clear()`) |
| `ore_changed` | `Array[int]` | leergefahrene Erzfelder (Feld-Index); Renderer leert |
| `alert_t` | `float` | Zeit der letzten Angriffswarnung |
| `garrisons` | `Array[Game.Garrison]` | Häuser, Kirche, Scheunen, Bunker |
| `g_at` | `Dictionary` | Feld-Index -> `Game.Garrison` |
| `on_sound` | `Callable` | `(event: String, x: float, y: float)`; Events = Projektilarten (`bullet`, `shell`, …) und `board, unload, capture, place, ready, unit, sell, jet, boom, hit, alert, promote, scream, explode, collapse` |
| `reveal` | `bool` | Nebel aus (Debug) |
| `start_credits`, `harvest_load`, `build_radius`, `ranks`, `rank_names`, `cover`, `gspec` | | Regeln aus `rules.json` |
| `path_budget_us`, `chase_budget_us` | `int` | Zeitbudget je Tick für Wegsuche (siehe unten) |

Konstanten: `Game.QUEUES`, `Game.ARMORS`, `Game.WCLASSES`, `Game.SPEED` (Projektil-Tempo), `Game.FX_KINDS`.

### Game – Methoden

| Methode | |
| --- | --- |
| `update(dt: float)` | ein Simulationsschritt |
| `command_move(units: Array, x: float, y: float, attack_move: bool)` | Bodentruppen/Schiffe in Formation, Hubschrauber im Kreis, Jets → Luftschlag, beladenes Landungsschiff auf Land → entladen |
| `command_attack(units: Array, t: Ent)`, `command_strike(jets: Array, t: Ent, x, y)`, `command_stop(units)` | |
| `command_harvest(units, tile: int)`, `command_return(units)` | |
| `command_board(units, ship: Ent)`, `command_unload(ship: Ent, x = null, y = null)` | ohne Punkt: hier an Land setzen |
| `command_garrison(units, g: Garrison)`, `command_exit(units)`, `command_capture(units, b: Ent)` | |
| `queue_item(p: int, q: String, key: String) -> bool`, `cancel_item(p, q, key)` | |
| `place_ready(p, tx: int, ty: int) -> bool`, `can_place(p, key, tx, ty) -> bool` | |
| `missing(p, req: Array) -> Array[String]`, `has_building(p, key) -> bool` | |
| `sell(e: Ent)`, `update_power()`, `update_fog()` | Reparieren: `e.repairing = true` |
| `add_unit(owner, key, x: float, y: float) -> Ent`, `add_building(owner, key, tx: int, ty: int) -> Ent` | |
| `range_of(u) -> float`, `dist(a, t) -> float`, `visible_to(p: int, e: Ent) -> bool`, `can_hit(u, t) -> bool` | |
| `garrison_of(b: Ent) -> Garrison`, `garrison_at(x, y) -> Garrison`, `can_enter(p, g) -> bool`, `g_dist(u, g) -> float` | |
| `shot_pos(s: Shot) -> Vector3` | (x, y, Höhe) |
| `add_fx(kind, x, y, z, vx, vy, vz, life, size)`, `boom(x, y, z, power, where: String)` | `where`: `ground, water, air, deck` |
| `damage(e, dmg, cls: String, from: int, src := 0)`, `kill(e, by: int, src := 0)`, `remove_building(e, destroyed: bool)` | |
| `msg(text, kind := "info", player := 0)`, `enemy_of(p) -> int` | |
| `exit_of(b) -> Vector2`, `slot_pos(b, s) -> Vector2`, `free_slot(owner, near: Ent = null) -> Array` (`[airfield, slot]` oder `[]`) | |
| `shore_point(x, y, max_r := 24)` | `{water: Vector2, land: Vector2}` oder `null` |
| `shore_tiles(tx, ty, w, h) -> int`, `formation(x, y, units: Array[Ent], naval) -> Array[Vector2]`, `pf_of(u) -> PathFinder` | |
| `set_dest(u, x, y)`, `set_dest_later(u, x, y)` | sofort / im Wegsuch-Budget der nächsten Ticks |
| `find_target(u, range) -> Ent`, `nearest_refinery(u) -> Ent`, `dock_of(ref) -> Vector2`, `find_ore(x, y, self_) -> int`, `mounts_turret(u) -> bool` | |
| `dispose()` | |
| `Game.ang_diff(a, b)`, `Game.turn_to(a, b, step)`, `Game.sort_order(keys: PackedFloat64Array) -> PackedInt32Array` | statisch |

### Innere Klassen von Game

| Klasse | Felder |
| --- | --- |
| `Game.Player` | `id: int, faction: String, ai: bool, credits: float, power_prod: int, power_use: int, units: Dictionary (key -> Def, nur spielbare), queues: Dictionary (Queue -> Array von QItem), alive: bool, stats: Game.Stats, primary: Dictionary (Queue -> Gebäude-id), income: float` |
| `Game.Stats` | `built: int, lost: int, killed: int, harvested: float` |
| `Game.QItem` | `key: String, paid: float, progress: float (0–1), ready: bool` |
| `Game.Garrison` | `id: int, kind: String (house/church/barn/bunker), name: String, x, y: float (Mitte), tx, ty, w, h: int, cap: int, occ: Array[Ent], owner: int (-1 niemand), range: float, sight: float, b: Ent (Bunker oder null)` |
| `Game.Shot` | `kind: String (bullet/shell/rocket/art/mlrs/flak/missile/snipe), owner: int, x0, y0, z0, x1, y1, z1: float, target: Ent, t: float, T: float (Flugzeit), arc: float, dmg: float, cls: String, splash: float, trail_t: float, src: int` |
| `Game.Fx` | `kind: String (exp/smoke/fire/flash/spark/dust/debris/wake/splash/ring/clod/ember), x, y, z, vx, vy, vz, t, life, size: float, shook: bool, scale: float (Vorgabe 1)`; `t < 0`: noch nicht begonnen |
| `Game.Wreck` | `key: String, owner: int, x, y, dir, tdir, t: float, air: bool, naval: bool` |
| `Game.Msg` | `text: String, t: float, kind: String (info/warn/good)` |
| `Game.Stamp` | `kind: String (scorch/rubble), size: int, x, y: float` |

### Ent

| Feld | Typ | |
| --- | --- | --- |
| `id, owner` | `int` | |
| `key` | `String` | |
| `is_b` | `bool` | Gebäude |
| `u`, `b` | `Dictionary` | Def aus `Data` (das jeweils andere ist leer) |
| `hp, max_hp, x, y, z, dir, tdir` | `float` | `tdir`: Turm bzw. Gebäudeausrichtung |
| `dead, moving, selected, repairing` | `bool` | |
| `path` | `PackedInt32Array` | Feld-Indizes; `pi: int` nächster Punkt |
| `dest, amove, guard, rally, unload_at` | `Variant` | `Vector2` oder `null` |
| `order` | `String` | `idle, move, attack, amove, harvest, board, unload, strike, enter, capture` |
| `target, last_attacker, carried_by, board_on, capture_b` | `Ent` | oder `null` |
| `speed_now, stuck_t, stuck_x, stuck_y, repath_t, scan_t, anim, cd, burst_t, cargo, mine_t, built, last_hit, smoke_t, rearm, jspeed, plane_t, launch_t, still_t, fired_t, flash_t, wake_t` | `float` | |
| `repaths, burst, ore_tile, tx, ty, w, h, home, slot, ammo, planes, kills, rank` | `int` | |
| `hs` | `String` | Erzlaster: `idle, toOre, mining, toRef, unload` |
| `js` | `String` | Jet: `park, out, back, land` |
| `strike` | `Ent.Strike` | `e: Ent, x, y: float` oder `null` |
| `passengers` | `Array[Ent]` | |
| `inside, enter_g` | `Game.Garrison` | oder `null` |
| Getter `weapon` | `Variant` | Waffen-Dictionary oder `null` |
| Getter `radius, sight` | `float` | `sight` mit Bonus aus dem Haus |
| Getter `air, naval, jet, hidden` | `bool` | `hidden`: Scharfschütze hält still |
| `path_wait` | `bool` | Weg wird noch gesucht (`set_dest_later`) |

Nur lesen (aus der Def zwischengespeichert, für die Simulation): `wp, has_wp, is_air, is_naval, is_jet, infantry,
urad, base_sight, armor_i, turret, w_range, w_min, w_gap, w_burst, w_cls_i, w_ground, w_air, w_sea`;
`reaches(t: Ent) -> bool`.

### AI

`AI.new(g: Game)`, `p: int` (Vorgabe 1), `update(dt: float)`.

### Abweichungen vom Prototyp (wegen GDScript-Tempo)

- **Sicht des Computers** (`visible_to(p, e)` für `p != 0`, und Haus-/Scharfschützen-Nähe für beide Seiten): während
  `update()` gegen eine Momentaufnahme der Beobachter vom Tick-Anfang, Ergebnis je Tick und Seite gemerkt. Außerhalb
  von `update()` exakt wie im TS.
- **Wegsuche:** `command_move` vergibt Wege über `set_dest_later` (höchstens ~`path_budget_us` je Tick, mindestens
  einer; bis dahin steht die Einheit mit `dest` und leerem `path`). Verfolgende Einheiten suchen erst im nächsten Tick,
  wenn das Budget des Ticks verbraucht ist. Gleiche Anfrage (Start-/Zielfeld, unveränderte Karte) liefert den
  gemerkten Weg. Ziele, die gar nicht erreichbar sind (andere Landmasse), suchen höchstens `UNREACHABLE_NODES` Felder
  statt 6000 (erreichbare Ziele unverändert).
- In heißen Schleifen (`dist`, `find_target`, Abstoßen) `sqrt(dx*dx+dy*dy)` statt `Rng.hypot`; Sortierungen stabil wie
  in JS (`Game.sort_order`); die eine Sortierung der KI mit inkonsistentem Vergleich bildet V8 nach.
- `Math.random()` → `randf()`; tote Einheiten lassen ihre Verweise los (keine Ringverweise).
- Spielbare Einheiten: `Player.units` enthält nur Einheiten ohne `planned` (wie im Browser).

### Tests der Simulation

- `… runner.tscn -- sim_scenarios` – Häuser, Bunker, Pionier, Landungsschiff, Jets, Träger (PASS/FAIL je Prüfung).
- `… runner.tscn -- sim_aivai [Minuten] [seed:karte …]` – KI gegen KI wie `balance/aivai.ts` (Sieger, Dauer,
  Verluste, gebaute Einheiten, ms je Tick); `sim_aivai stress [je Seite] [seed:karte]` – Massenschlacht, ms je Tick.
- `… runner.tscn -- sim_timeline [seed] [karte] [Minuten]` – Verlauf alle 30 s zum Vergleich mit dem Prototyp.

## View-API

Darstellung: `scripts/view/world.gd` (`World`, Node2D; Port von `render.ts`, `atmos.ts` und den Bodenmarken aus
`terrain.ts`), dazu `terrain.gd` (`Terrain`: TileMapLayer-Boden, Baum-/Hausschatten, Brandflecken, Trümmer),
`atmos.gd` (`Atmos`: Wasser-Glitzern/Brandung als MultiMesh mit Shader, Wolkenschatten, Tageszeit, Regen),
`art.gd` (`Art`: alle Sheets aus dem Manifest, statisch geladen), `sheet.gd` (`Sheet`: ein Sheet, zeichnet Zellen
über den RenderingServer). Teststeuerung: `debug_input.gd` (`DebugInput`), Gefecht: `scripts/battle.gd`.

```gdscript
var world := World.new()
add_child(world)          # erst in den Baum, dann setup
world.setup(game)         # Boden, Ebenen, Kamera; zeichnet danach jedes Bild selbst (_process)
```

Alles in **Weltpixeln** (die feinen Pixel des Prototyps: Feld 64 × 32, Höhe × 2,5). Die Welt wird wie im
Prototyp 1:1 in ein SubViewport (Fenstergröße / Zoom, gerade Maße) gezeichnet und auf einer CanvasLayer
(`layer = -1`, unter der Oberfläche) mit harten Pixeln hochskaliert. Die Oberfläche gehört auf eine eigene
CanvasLayer (≥ 0) und rechnet Bildschirmpunkte nur über `screen_to_px` um.

| Mitglied | |
| --- | --- |
| `game: Game`, `terrain: Terrain`, `atmos: Atmos` | |
| `camera: Camera2D` | im SubViewport; `position` = Mitte der Ansicht in Weltpixeln. **`zoom` bleibt 1** – Zoom nur über `set_zoom_level` |
| `LEVELS = [1, 1.5, 2, 3]`, `zoom_level: int`, `zoom: float` (Getter) | Bildschirmpixel je Weltpixel; Start: 1 (= 1,5) bei Fensterbreite > 1500, sonst 0 |
| `set_zoom_level(i, anchor_screen := Vector2.INF)` | der Weltpunkt unter `anchor_screen` (Bildschirmpixel) bleibt stehen; ohne Anker die Mitte |
| `pan_screen(delta: Vector2)` | Ansicht um `delta` Bildschirmpixel verschieben (+x: Ansicht nach rechts; Ziehen mit der Maus: `-relative`) |
| `look_at_tile(x, y)`, `clamp_camera()` | Mitte auf ein Feld (Grenzen wie `clampCam`) |
| `tile_to_px(x, y, z := 0.0) -> Vector2`, `px_to_tile(p) -> Vector2` | Felder ↔ Weltpixel (Boden) |
| `screen_to_px(p) -> Vector2`, `px_to_screen(p) -> Vector2` | Bildschirm (Viewport-Pixel) ↔ Weltpixel, ohne Wackeln |
| `pick(px: Vector2) -> Ent` | oberste Einheit/Gebäude unter einem Weltpixel (Regeln wie `pick` in render.ts, Fremde nur wenn `shown`) |
| `pick_garrison(px) -> Game.Garrison` | Haus/Kirche/Scheune/Bunker unter einem Weltpixel (nur aufgedeckt) |
| `shown(e: Ent) -> bool` | wird die Einheit gezeichnet (Nebel, versteckte Scharfschützen, getragen/im Haus) |
| `add_shake(k)` | Bildwackeln wie `addShake` |
| `overlay: Dictionary` | `box`: `Rect2` in Bildschirmpixeln (Auswahlrahmen), `place`: `{key, tx, ty, ok}` (Bauplatz mit Grundriss), `hover_ent: Ent`, `hover_g: Game.Garrison`, `move_mark: {x, y, t, attack}` (`t` = `game.time` des Befehls); jeweils `null` = aus |
| `paused: bool` | kein Regen-Fortschritt (dt = 0), wie `draw(o, 0)` |
| `auto_draw: bool`, `redraw(dt)`, `draw_ms`, `profile` | Tests: selbst zeichnen, Zeit der letzten Füllung (ms), Teilzeiten (`profile = {}`) |

Die Welt leert jedes Bild `game.stamps`, `game.ore_changed` und setzt `game.fog_dirty = false` (wie der Prototyp);
Gebäude im Aufbau erzeugen Staub über `game.add_fx` (wie im Prototyp aus dem Renderer). Auswahl (`e.selected`),
Sammelpunkte (`e.rally`) und Häuser der gewählten Soldaten zeichnet die Welt von selbst.

Ebenen (je ein Canvas-Item, jedes Bild neu gefüllt, nur Sichtbares): Boden (TileMapLayer + Schatten/Marken in
16×16-Feld-Stücken) → Wasser (Shader) → Schatten, Auswahlringe → Statisches/Erz/Wracks/Gebäude/Einheiten nach
`x + y` sortiert, Flieger nach Höhe → Nachbrenner (additiv) → Wolkenschatten, Gebäudeklammern → Rauch/Staub/
Gischt → Tageszeit (multiplikativ) → Lichter (additiv) → Geschosse → Explosionen/Feuer/Ringe (+ additiv) → Regen →
Balken, Ränge, Fahnen → Nebel (Bild N×N, linear gefiltert, durch die Projektion) → Overlay.

Tests: `… runner.tscn -- shot_battle <ordner> [base_day base_night arty sea air village rain]` (Bilder),
`… -- view_aivai [minuten] [seed:karte] [zoomstufe] [bildordner]` (KI gegen KI mit Darstellung, Zeiten),
`… -- view_aivai stress [je Seite] [seed:karte] [zoomstufe] [sekunden]`, `… -- view_battle` (battle.gd).
