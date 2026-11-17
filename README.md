# Pixelfront

Ein Echtzeit-Strategiespiel in isometrischer Pixel-Art: NATO gegen Russland auf einem zufällig
erzeugten Schlachtfeld in Mitteleuropa, mit Basenbau, Erzabbau, Landkrieg, Luftwaffe und Marine.

Die Technik orientiert sich an Sprite-Stacking-Spielen wie fly.ui8.dev: Alle Einheiten, Schiffe,
Gebäude, Bäume, Häuser und sogar das Titel-Logo sind **Voxel-Modelle, die im Code entstehen**.
Beim Laden werden sie für jede Blickrichtung in kleine Pixel-Sprites gerendert, mit harter
Beleuchtung in wenigen Tönen und Umrisslinien wie bei handgemachter Pixel-Art. Das Spiel zeichnet
in einen niedrig aufgelösten Puffer und skaliert ihn mit harten Pixeln hoch. Es gibt keine Engine
und keine Bilddateien.

## Spielen

```bash
npm install
```

```bash
npm run dev
```

Danach `http://localhost:5173` öffnen. `npm run build` erzeugt `dist/` (für GitHub Pages),
`npm run build:single` eine einzelne, eigenständige `dist-single/index.html`.

## Menü

Hinter dem Menü läuft eine echte Schlacht zwischen zwei Computergegnern. Einstellbar sind:

- **Seite:** NATO oder Russland
- **Gegner:** Leicht, Normal, Schwer
- **Gelände:**
  - Binnenland: Fluss, keine Marine
  - Küste: Meer im Norden
  - Seenplatte: großer See mit Armen zu beiden Basen
- **Tageszeit:** Tag, Abend, Nacht (mit Fenstern, Scheinwerfern und Positionslichtern)
- **Wetter:** Klar, Bewölkt (Wolkenschatten), Regen (mit Blitzen)
- **Karte:** eine Nummer, damit sich eine Karte wiederholen lässt

## Spielablauf

- Du startest mit Hauptquartier, einem Schützenpanzer und drei Schützen.
- **Bau**-Reiter: Gebäude bauen. Wenn „Bereit“ erscheint, anklicken und auf der Karte platzieren.
- **Kraftwerke** liefern Strom. Ohne genug Strom läuft die Produktion halb so schnell.
- **Rohstoffdepots** bringen einen Erzlaster mit. Laster bauen Erz ab und liefern es als Rohstoffe ab.
- Produktion wird bezahlt, während sie läuft.
- **Ränge:** Einheiten mit 3, 7 und 12 Abschüssen steigen auf (Gefreiter, Feldwebel, Veteran). Sie
  richten mehr Schaden an und halten mehr aus, Veteranen heilen sich selbst.
- Sieg: Alle Gebäude des Gegners sind zerstört.

### Gebäude

| Gebäude | Kosten | Voraussetzung | Zweck |
| --- | --- | --- | --- |
| Kraftwerk | 300 | – | Strom |
| Rohstoffdepot | 1600 | Kraftwerk | Erz annehmen, bringt Erzlaster mit |
| Kaserne | 400 | Kraftwerk | Infanterie |
| Fahrzeugwerk | 1800 | Rohstoffdepot | Fahrzeuge |
| Radarstation | 900 | Fahrzeugwerk | schaltet schwere Einheiten frei |
| Werft | 1200 | Rohstoffdepot | Schiffe; muss am Ufer stehen, darf weiter weg von der Basis sein |
| Hubschrauberplatz | 1200 | Radarstation | Kampfhubschrauber |
| Flugfeld | 1800 | Radarstation | Kampfjets, drei Stellplätze |
| MG-Bunker | 500 | Kaserne | Abwehr gegen Infanterie; bis zu 3 Soldaten steigen ein und schießen mit |
| Raketenstellung | 750 | Fahrzeugwerk | Abwehr gegen Panzer, Schiffe und Luft |

### Einheiten

| Reiter | Einheiten |
| --- | --- |
| Infanterie | Schütze, Panzerabwehr, Scharfschütze (unsichtbar, solange er stillhält), Pionier (erobert feindliche Gebäude) |
| Fahrzeuge | Erzlaster, Spähwagen, Schützenpanzer, Kampfpanzer, Flakpanzer, Rohrartillerie, Raketenartillerie |
| Luft | Kampfhubschrauber, Kampfjet (Luftschlag, danach zurück zum Aufmunitionieren) |
| See | Patrouillenboot, Korvette, Zerstörer bzw. Raketenkreuzer, Landungsschiff (5 Plätze), Flugzeugträger (3 eigene Jets) |

Die Fahrzeuge tragen die Namen realer Vorbilder:

| Rolle | NATO | Russland |
| --- | --- | --- |
| Infanterie | Grenadier (G36) | Schütze (AK-74) |
| Panzerabwehr | Panzerfaust 3 | RPG-7 |
| Scharfschütze | G22 | SWD |
| Pionier | Pionier | Pionier (Sapjor) |
| Erzlaster | MAN | KAMAZ |
| Spähwagen | Fennek | BRDM-2 |
| Schützenpanzer | Marder 1A5 | BMP-2 |
| Kampfpanzer | Leopard 2A6 | T-90A |
| Flakpanzer | Gepard 1A2 | 2K22 Tunguska |
| Rohrartillerie | Panzerhaubitze 2000 | 2S19 Msta-S |
| Raketenartillerie | MARS II | BM-21 Grad |
| Kampfhubschrauber | AH-64 Apache | Mi-24 Hind |
| Kampfjet | Eurofighter | Su-34 |
| Patrouillenboot | Schnellboot S143 | Raptor |
| Korvette | K130 | Steregushchiy |
| Zerstörer / Kreuzer | Arleigh Burke | Slava-Kreuzer |
| Landungsschiff | LCU 1700 | Ondatra |
| Flugzeugträger | Nimitz | Admiral Kusnezow |

### Häuser besetzen

Infanterie kann die Häuser der Dörfer (Wohnhaus und Fachwerkhaus 4, Scheune 3, Kirche 6 Plätze) und die
eigenen MG-Bunker (3 Plätze) besetzen. Drinnen gilt:

- **Deckung:** nur 30 % des Schadens kommen bei den Insassen an. Die Häuser selbst sind unzerstörbar,
  ein gesprengter Bunker wirft seine Besatzung mit halbem Leben hinaus.
- **Reichweite und Sicht:** Wohnhaus +1,5 / +2, Scheune +1 / +1,5, Kirche (Turm) +2,5 / +4, Bunker +1 / +1.
- **Unsichtbar:** Der Feind sieht nur die Fahne auf dem Dach – bis Mündungsfeuer die Schützen verrät
  oder ein Gegner direkt am Haus steht. Ein gezielter Angriffsbefehl aufs Haus trifft die Insassen trotzdem.
- **Pioniere** erobern feindliche Gebäude: Rechtsklick auf das Gebäude, der Pionier geht hinein und
  das Gebäude wechselt die Seite (Besatzung eines Bunkers muss hinaus).

Die KI besetzt Häuser in Basisnähe und schickt ab der mittleren Stufe gelegentlich Pioniere los.

Die beiden Seiten unterscheiden sich in Aussehen und Werten: NATO hat mehr Reichweite und
Präzision, Russland mehr Panzerung und niedrigere Preise. Fährt die Maus über ein Feld im Baumenü, erscheint die
vollständige Datenkarte mit Schaden, Reichweite, Panzerung und Zielen.

## Steuerung

| Eingabe | Wirkung |
| --- | --- |
| Linksklick / Rahmen ziehen | auswählen (Umschalt: hinzufügen, Doppelklick: alle gleichen im Bild) |
| Rechtsklick | bewegen, angreifen, Erz abbauen, Sammelpunkt setzen |
| Rechtsklick aufs eigene Landungsschiff | Bodentruppen steigen ein (das Schiff kommt ans Ufer) |
| Landungsschiff auf Land schicken / D | Truppen dort anlanden / hier entladen |
| Jets + Rechtsklick | Luftschlag auf ein Ziel oder einen Punkt |
| Infanterie + Rechtsklick aufs Haus / eigenen Bunker | Haus besetzen (Fahne zeigt den Besitzer, Kästchen die Belegung) |
| Linksklick aufs eigene Haus / Doppelklick auf Bunker | die Insassen auswählen |
| D (oder Knopf „Räumen“) | Haus bzw. Bunker räumen |
| Pionier + Rechtsklick auf feindliches Gebäude | Gebäude erobern |
| A + Linksklick | Angriffsbewegung |
| S | Stopp |
| F1–F5, Tab | Baureiter wechseln |
| Y X C V B N M , . - | Feld im Baumenü bauen / platzieren |
| Strg + 1–9 / 1–9 | Gruppe bilden / wählen (zweimal: hinspringen) |
| Q / E | ganze Armee / Kampfeinheiten im Bild |
| Leertaste / H | zur Auswahl / zum Hauptquartier |
| Pfeiltasten, Bildschirmrand, mittlere Maustaste | Ansicht verschieben |
| Mausrad | Zoom |
| P | Pause (dort lässt sich das Filmkorn abschalten) |

## Aufbau des Codes

| Datei | Inhalt |
| --- | --- |
| `src/core/voxel.ts` | Voxel-Modelle und der Renderer, der daraus Sprites macht |
| `src/core/iso.ts` | isometrische Projektion und Farbhilfen |
| `src/game/units3d.ts` | alle Einheiten nach realen Vorbildern, mit Animationsbildern (Ketten, Radare, Lauf- und Zielhaltung) |
| `src/game/models.ts` | Gebäude, Landschaft, Logo |
| `src/game/map.ts` | Kartengenerator für Binnenland, Küste und Seenplatte |
| `src/game/terrain.ts` | malt den Boden einmal in ein großes Bild |
| `src/game/atmos.ts` | Wasser und Brandung, Wolken, Tageszeit, Lichter, Regen, Filmkorn |
| `src/game/game.ts` | Spiellogik: Bewegung an Land und auf See, Kampf, Jets, Träger, Transport, Ränge, Produktion, Nebel |
| `src/game/path.ts` | A*-Wegfindung mit Pfadglättung, für Land und Wasser |
| `src/game/ai.ts` | Computergegner mit Heer, Marine und Luftschlägen |
| `src/game/render.ts` | zeichnet ein Bild: Boden, Schatten, Objekte, Effekte, Licht, Nebel |
| `src/game/input.ts` | Maus und Tastatur |
| `src/ui/hud.ts` | Seitenleiste: Lagekarte, Baumenü mit Datenkarten, Auswahl, Funkprotokoll |

`preview.html` (nur im Dev-Server) zeigt alle Modelle nebeneinander.

### Sprite-Export für Godot

`export.html` (nur im Dev-Server: `npm run dev`, dann `/export.html` öffnen) rendert alle Modelle
und packt sie als PNG-Sprite-Sheets in `pixelfront_sprites.zip`: Einheiten beider Fraktionen in
32 Richtungen (Infanterie 16) mit Schatten, Türmen, Ketten- und Radar-Animation, Geh- und
Zielposen, Wracks und Icons; Gebäude, Landschaft, Erz, Explosionen, Rauch, Feuer und das Logo.
`manifest.json` beschreibt Zellgröße, Ankerpunkt, Richtungen, Turm-Versatz je Richtung und die
Animationsregeln; die `README.md` im ZIP zeigt das Einrichten in Godot 4 mit GDScript.
Ändert sich ein Modell, einfach neu exportieren.

## Noch offen

- Ton und Musik
