# Pixelfront – Godot-Version

Die Godot-4-Fassung des Browser-Prototyps (`../src`). Gleiche Karten, gleiche Werte, gleiche Regeln
(`../docs/REGELWERK.md`); Grafik und Daten kommen aus dem Sprite-Export des Prototyps.

## Öffnen und starten

1. **Godot 4.7** (Standard-Version, nicht .NET) von godotengine.org laden.
2. Godot starten → *Importieren* → `godot/project.godot` wählen. Beim ersten Öffnen importiert Godot
   alle Bilder und Töne (ein bis zwei Minuten).
3. **F5** startet das Spiel (Hauptszene `scenes/main.tscn`: Menü, dann Gefecht).

Projekt-Einstellungen, die schon gesetzt sind: Renderer *Compatibility* (läuft auf PC und Handy),
Texturfilter *Nearest* (scharfe Pixel), Fenster frei skalierbar, Querformat auf Mobilgeräten.

## Aufbau

| Ordner | Inhalt |
| --- | --- |
| `assets/sprites/` | alle Sprite-Sheets, Kachelsatz, UI-Grafik, `manifest.json`, `data/*.json` (aus dem Export) |
| `assets/sounds/` | Platzhalter-Töne und `sounds.json` (siehe `../docs/SOUND.md`) |
| `scripts/data.gd` | Autoload `Data`: Werte, Schadenstabelle, Regeln, Texturen |
| `scripts/sound.gd` | Autoload `Sound`: spielt die Ton-Ereignisse |
| `scripts/core/` | Zufall und Rauschen, bitgenau wie im Prototyp |
| `scripts/game/` | Karte, Wegfindung, Spiellogik, KI (ohne Darstellung) |
| `scripts/view/` | Gelände, Einheiten, Effekte, Nebel, Licht, Steuerung |
| `scripts/ui/` | Menü, Oberfläche im Gefecht, Design |
| `tests/` | automatische Tests (siehe unten) |

Wie TypeScript-Namen übertragen wurden: `PORTING.md`.

## Grafik und Töne aktualisieren

Wenn sich Modelle im Prototyp ändern: im Hauptordner

```bash
tools/update-godot-assets.sh
```

(braucht Node, Playwright mit Chromium und Python mit NumPy). Ohne diese Werkzeuge: im Prototyp
`npm run dev`, `/export.html` öffnen, ZIP laden und den Inhalt von `pixelfront_sprites/` nach
`godot/assets/sprites/` kopieren.

## Tests

```bash
godot --headless --path godot res://tests/runner.tscn -- sim_aivai
godot --headless --path godot res://tests/runner.tscn -- sim_scenarios
godot --headless --path godot -s tests/map_parity.gd
```

`map_parity` gibt Prüfsummen aus, die mit dem Prototyp übereinstimmen müssen (gleiche Karten und Wege).

## Exportieren

- **Windows/Linux:** *Projekt → Exportieren → Hinzufügen*, Vorlagen über den Dialog herunterladen.
- **Android:** Android-SDK und OpenJDK 17 einrichten (Godot-Doku „Exporting for Android“),
  Vorlage *Android* hinzufügen. Die Steuerung erkennt Touch automatisch (Tippen, Ziehen, Zwei-Finger-Zoom,
  Knopf für den Auswahlrahmen).
- **iOS:** braucht einen Mac mit Xcode.
