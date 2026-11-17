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

## Steuerung

**Maus und Tastatur**

| | |
| --- | --- |
| Linksklick / Rahmen ziehen | auswählen (Umschalt: hinzufügen/abwählen, Doppelklick: alle gleichen im Bild; eigenes Haus: die Soldaten darin, Bunker doppelt: Besatzung) |
| Rechtsklick | bewegen, angreifen, Erz abbauen / zum Depot, Haus oder eigenen Bunker besetzen, feindlich besetztes Haus beschießen, Pionier: Gebäude erobern, aufs eigene Landungsschiff: einsteigen; mit Gebäuden: Sammelpunkt |
| A + Linksklick | Angriffsbewegung (mit Umschalt bleibt der Modus an) · Rechtsklick/Esc bricht ab |
| S · D | Stopp · Landungsschiff entladen, Haus/Bunker räumen |
| F1–F5, Tab | Baureiter (Bau, Infanterie, Fahrzeuge, Luft, See) |
| Y X C V B N M , . - | Felder des Baumenüs (Klick: in Auftrag geben / fertiges Gebäude platzieren, Rechtsklick: abbrechen) |
| Strg + 1–9 · 1–9 | Gruppe bilden · Gruppe wählen (zweimal: hinspringen) |
| Q · E · Leertaste · H | ganze Armee · Kampfeinheiten im Bild · zur Auswahl · zum Hauptquartier |
| Esc | Bauen/Angriffsmodus abbrechen, sonst Auswahl aufheben (im Pause-Menü: weiter) |
| Pfeiltasten, Bildschirmrand, mittlere Maustaste ziehen | Ansicht verschieben |
| Mausrad | Zoom am Mauszeiger (die Stufe wird gemerkt) |
| P, F10, Knopf „Menü“ | Pause mit Menü |
| Lagekarte | Klick/Ziehen: Ansicht dorthin · Rechtsklick: Auswahl dorthin schicken |

**Touch** (Handy, Tablet; die Oberfläche ist dort 1,5-mal so groß)

| | |
| --- | --- |
| Tippen | auswählen; mit eigener Auswahl: Befehl wie ein Rechtsklick (eigene Einheit antippen wählt sie) |
| zweimal tippen | alle gleichen Einheiten im Bild |
| lange drücken | Angriffsbewegung |
| ein Finger ziehen | Karte verschieben |
| Knopf „Rahmen“ (unten rechts) | ein Finger zieht nun einen Auswahlrahmen (nochmal tippen: aus) |
| Knopf „X“ | Auswahl aufheben, Bauen abbrechen |
| zwei Finger | zoomen und verschieben |
| Baumenü lange drücken | Auftrag abbrechen |

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
xvfb-run -a godot --path godot --rendering-driver opengl3 --resolution 1600x900 res://tests/runner.tscn -- ui_flow
```

`map_parity` gibt Prüfsummen aus, die mit dem Prototyp übereinstimmen müssen (gleiche Karten und Wege).

## Exportieren

- **Windows/Linux:** *Projekt → Exportieren → Hinzufügen*, Vorlagen über den Dialog herunterladen.
- **Android:** Android-SDK und OpenJDK 17 einrichten (Godot-Doku „Exporting for Android“),
  Vorlage *Android* hinzufügen. Die Steuerung erkennt Touch automatisch (Tippen, Ziehen, Zwei-Finger-Zoom,
  Knopf für den Auswahlrahmen).
- **iOS:** braucht einen Mac mit Xcode.
- **Windows-Setup:** im Hauptordner `tools/build-windows-setup.sh <version> <godot>` → `build/Pixelfront-Setup-<version>.exe`
  (Assistent auf Deutsch, Startmenü/Desktop-Verknüpfung, Deinstallation).
- **Export prüfen:** `Pixelfront -- --schnellstart [seed]` startet ohne Menü direkt ein Gefecht (Küstenkarte).
