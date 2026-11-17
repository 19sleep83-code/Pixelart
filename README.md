# Pixelfront

Ein Echtzeit-Strategiespiel in isometrischer Pixel-Art: NATO gegen Russland auf einem
zufällig erzeugten Schlachtfeld in Mitteleuropa, mit Basenbau, Erzabbau und Kampf.

Die Technik orientiert sich an Sprite-Stacking-Spielen wie fly.ui8.dev: Alle Einheiten, Gebäude,
Bäume und Häuser sind **Voxel-Modelle, die im Code entstehen**. Beim Laden werden sie für jede
Blickrichtung in kleine Pixel-Sprites gerendert, mit harter Beleuchtung in wenigen Tönen und
Umrisslinien wie bei handgemachter Pixel-Art. Das Spiel zeichnet in einen niedrig aufgelösten
Puffer und skaliert ihn mit harten Pixeln hoch. Es gibt keine Engine und keine Bilddateien.

## Spielen

```bash
npm install
```

```bash
npm run dev
```

Danach `http://localhost:5173` öffnen. `npm run build` erzeugt `dist/` (für GitHub Pages),
`npm run build:single` eine einzelne, eigenständige `dist-single/index.html`.

## Spielablauf

- Du startest mit Hauptquartier, einem Schützenpanzer und drei Schützen.
- **Bau**-Reiter: Gebäude bauen, wenn „Bereit“ erscheint, anklicken und auf der Karte platzieren
  (nur in der Nähe eigener Gebäude).
- **Kraftwerk** liefert Strom. Wird mehr Strom verbraucht als erzeugt, läuft die Produktion halb so schnell.
- **Rohstoffdepot** bringt einen Erzlaster mit. Laster bauen Erz ab und liefern es als Rohstoffe ab.
- Produktion wird bezahlt, während sie läuft. Ohne Rohstoffe stockt sie.
- Sieg: Alle Gebäude des Gegners sind zerstört.

| Gebäude | Kosten | Freischaltung |
| --- | --- | --- |
| Kraftwerk | 300 | – |
| Rohstoffdepot | 1600 | Kraftwerk |
| Kaserne | 400 | Kraftwerk |
| Fahrzeugwerk | 1800 | Rohstoffdepot |
| Radarstation | 900 | Fahrzeugwerk |
| Hubschrauberplatz | 1200 | Radarstation |
| MG-Bunker | 500 | Kaserne |
| Raketenstellung | 750 | Fahrzeugwerk |

Einheiten: Schütze, Panzerabwehr, Erzlaster, Schützenpanzer, Kampfpanzer, Flakpanzer,
Panzerhaubitze (NATO) bzw. Raketenwerfer (Russland), Kampfhubschrauber. Die beiden Seiten
unterscheiden sich in Aussehen und Werten (NATO: Reichweite und Präzision, Russland: Panzerung und Preis).

## Steuerung

| Eingabe | Wirkung |
| --- | --- |
| Linksklick / Rahmen ziehen | auswählen (Umschalt: hinzufügen, Doppelklick: alle gleichen im Bild) |
| Rechtsklick | bewegen, angreifen, Erz abbauen, Sammelpunkt setzen |
| A + Linksklick | Angriffsbewegung |
| S | Stopp |
| Strg + 1–9 / 1–9 | Gruppe bilden / wählen (zweimal: hinspringen) |
| Q / E | ganze Armee / Kampfeinheiten im Bild |
| Leertaste / H | zur Auswahl / zum Hauptquartier |
| Pfeiltasten, Bildschirmrand, mittlere Maustaste | Ansicht verschieben |
| Mausrad | Zoom |
| P | Pause |

## Aufbau des Codes

| Datei | Inhalt |
| --- | --- |
| `src/core/voxel.ts` | Voxel-Modelle und der Renderer, der daraus Sprites macht |
| `src/core/iso.ts` | isometrische Projektion und Farbhilfen |
| `src/game/models.ts` | alle Modelle: Fahrzeuge, Soldaten, Gebäude, Bäume, Häuser, Erz |
| `src/game/map.ts` | Kartengenerator: Felder, Wälder, Fluss, Straßen, Brücken, Dörfer, Erz |
| `src/game/terrain.ts` | malt den Boden einmal in ein großes Bild |
| `src/game/game.ts` | Spiellogik: Bewegung, Kampf, Produktion, Erzabbau, Nebel |
| `src/game/path.ts` | A*-Wegfindung mit Pfadglättung |
| `src/game/ai.ts` | Computergegner |
| `src/game/render.ts` | zeichnet ein Bild: Boden, Schatten, Objekte, Effekte, Nebel |
| `src/game/input.ts` | Maus und Tastatur |
| `src/ui/hud.ts` | Seitenleiste mit Minikarte, Baumenü und Auswahl |

`preview.html` (nur im Dev-Server) zeigt alle Modelle nebeneinander.

## Noch offen

- Ton und Musik
