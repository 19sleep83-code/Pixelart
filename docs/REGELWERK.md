# Pixelfront – Regelwerk

Wie das Spiel rechnet, so wie es der Browser-Prototyp tut. Grundlage für die Portierung nach
Godot: Wer die Regeln hier und die Werte in `data/*.json` (Sprite-Export) übernimmt, bekommt
dasselbe Spielgefühl. Strecken in **Feldern**, Zeiten in **Sekunden**, Geld in **Credits**.

## 1. Die Seiten

NATO und Russland haben **identische Werte**. Jede Rolle (Kampfpanzer, Flak, Zerstörer …) kostet
gleich viel, hält gleich viel aus und schießt gleich. Unterschiede gibt es nur bei Name und
Aussehen (Leopard 2A6 / T-90A …) und bei der Rumpflänge der Schnellboote (Kollision).

## 2. Wirtschaft

| Regel | Wert |
| --- | --- |
| Startkapital | 5000 |
| Erz je Feld | 900 |
| Erzlaster: Ladung | 500, abgebaut in Schritten zu 50 alle 0,5 s |
| Abladen am Rohstoffdepot | volle Ladung in 2,2 s |
| Jedes neue Rohstoffdepot | bringt einen Erzlaster mit |
| Pleite ohne Erzlaster | +8 Credits/s, solange unter 1000 (damit niemand festsitzt) |
| Bauen | wird während der Bauzeit anteilig bezahlt; abbrechen erstattet das Bezahlte |
| Mehrere gleiche Produktionsgebäude | +50 % Tempo je weiterem Gebäude |
| Verkaufen | 50 % des Preises × Anteil der Lebenspunkte |
| Reparieren | volle Lebenspunkte in 25 s, kostet 30 % des Gebäudepreises anteilig |
| Gebäude bauen | auf freiem Boden, höchstens 5 Felder (Werft: 14) von einem eigenen Gebäude; die Werft braucht mindestens 3 Wasserfelder am Rand |
| Gebäude „wächst“ nach dem Platzieren | 1,6 s |

**Strom:** Kraftwerke liefern +100, das Hauptquartier +20, alle anderen Gebäude verbrauchen.
Ist der Verbrauch höher als die Leistung, läuft jede Produktion mit 45 % Tempo, Abwehrstellungen
feuern halb so schnell, Jets munitionieren halb so schnell auf.

**KI-Schwierigkeit:** Produktion ×0,8 / ×1 / ×1,25 und Einnahmen ×0,75 / ×1 / ×1,3 (leicht / normal / schwer).

## 3. Kampf

### Schaden

```
Schaden = Waffenschaden × (1 + 0,12 × Rang des Schützen)
        × Tabelle[Waffenart][Panzerung]
        × Zufall 0,9 … 1,1
        × (1 − 0,07 × Rang des Ziels)
        × 0,3, wenn das Ziel in einem Haus oder Bunker sitzt
```

Flächenwaffen treffen alles im Radius `splash`, am Rand noch mit 40 % (Abfall 1 − d/splash × 0,6).
Artillerie, Raketenwerfer und Marschflugkörper auf einen Punkt streuen (Rohr ±0,5, Raketenwerfer ±1,2 Felder).

### Schadenstabelle (Waffenart × Panzerung)

| Waffe \ Panzerung | Infanterie | leicht | schwer | Gebäude | Luft | Schiff |
| --- | --- | --- | --- | --- | --- | --- |
| MG (mg) | 1 | 0,2 | 0,05 | 0,2 | 0,06 | 0,15 |
| Kanone (cannon) | 0,45 | 1 | 0,9 | 0,75 | – | 0,8 |
| Maschinenkanone (auto) | 0,85 | 0,8 | 0,25 | 0,35 | 0,25 | 0,6 |
| Panzerabwehr-Rakete (rocket) | 0,3 | 1 | 1 | 0,65 | 0,9 | 0,8 |
| Artillerie (art) | 0,9 | 0,7 | 0,45 | 1 | – | 0,7 |
| Flak (flak) | 0,4 | 0,3 | 0,1 | 0,15 | 1,5 | 0,15 |
| Scharfschütze (sniper) | 1,6 | 0,05 | 0,02 | 0,02 | – | 0,02 |
| Marschflugkörper (missile) | 0,5 | 1 | 1 | 1 | 0,8 | 1,1 |

Zusätzlich legt jede Waffe fest, ob sie Boden-, Luft- und/oder Seeziele angreifen kann.

### Zielwahl

Einheiten suchen Ziele in Waffenreichweite (wartend: bis Sicht − 1, bei Angriffsbewegung: Sicht).
Bewertung: Entfernung − 3 × Wirksamkeit laut Tabelle − 1,5, wenn das Ziel selbst bewaffnet ist,
+2 bei Gebäuden; der niedrigste Wert gewinnt. Wartende Einheiten verfolgen höchstens bis
Reichweite + 5 Felder von ihrem Posten und kehren dann zurück. Wer beschossen wird und nichts
zu tun hat, schießt zurück. Fahrzeuge mit Turm schießen auch während der Fahrt; Infanterie bleibt
zum Schießen stehen. Artillerie unter ihrer Mindestreichweite weicht 3 Felder zurück.

### Ränge

| Rang | Abschüsse | Wirkung |
| --- | --- | --- |
| Rekrut | 0 | – |
| Gefreiter | 3 | +12 % Schaden, −7 % erlittener Schaden |
| Feldwebel | 7 | +24 %, −14 % |
| Veteran | 12 | +36 %, −21 %, heilt sich selbst 1 % pro Sekunde |

Bei jeder Beförderung +25 % der Lebenspunkte.

## 4. Sicht und Tarnung

Jede Einheit und jedes Gebäude sieht im Kreis seiner Sichtweite (Nebel des Krieges, alle 0,2 s
aktualisiert). Erkundetes Gelände bleibt halb sichtbar.

- **Scharfschütze:** nach 2,5 s Stillhalten ohne Schuss getarnt; nur Gegner näher als 2,2 Felder sehen ihn.
- **Soldaten in Häusern:** unsichtbar, nur die Fahne zeigt den Besitzer. Sichtbar für 2,5 s nach
  jedem Schuss oder für Gegner näher als 1,2 Felder an der Hauswand. Ein ausdrücklicher Angriffsbefehl
  auf das Haus trifft die Insassen trotzdem.

## 5. Häuser besetzen und Gebäude erobern

| Ort | Plätze | + Reichweite | + Sicht |
| --- | --- | --- | --- |
| Wohnhaus / Fachwerkhaus | 4 | 1,5 | 2 |
| Scheune | 3 | 1 | 1,5 |
| Kirche | 6 | 2,5 | 4 |
| eigener MG-Bunker | 3 | 1 | 1 (der Bunker selbst +0,5 Reichweite, solange besetzt) |

- Nur Infanterie (keine Pioniere) kann hinein, nur in leere oder eigene Häuser.
- Häuser sind unzerstörbar, Schaden geht nur an die Insassen (×0,3).
- Ein zerstörter Bunker wirft seine Besatzung mit −50 % Lebenspunkten hinaus.
- Wird ein Haus leer, ist es wieder neutral.
- **Pionier:** erreicht er ein feindliches Gebäude (alle, auch das Hauptquartier), wechselt es den
  Besitzer; der Pionier wird verbraucht. Die Besatzung eines eroberten Bunkers muss hinaus.

## 6. Bewegung

- Wegfindung A* auf dem Feldraster (Boden und Wasser getrennt), Straßen ×1,25 Tempo, Felder ×0,92, Sand ×0,85.
- Fahrzeuge drehen mit ihrer Wendigkeit (rad/s) und fahren erst richtig los, wenn sie ungefähr in Fahrtrichtung zeigen.
- Formation: Fahrzeuge je ein Feld, bis zu 3 Soldaten pro Feld, Schiffe halten Platz für ihren ganzen Rumpf frei.
- Einheiten schieben sich gegenseitig auseinander; Schiffe als lange Kapseln (halbe Länge/Breite im Feld `hull`), das kleinere weicht mehr aus.
- Steckt eine Einheit 1,6 s fest, sucht sie bis zu 3-mal einen neuen Weg.

## 7. Luft und See

- **Hubschrauber** fliegen frei über alles.
- **Kampfjets** stehen auf einem der 3 Stellplätze des Flugfelds, fliegen auf Befehl einen
  Luftschlag (Ziel oder Punkt), kehren zurück und munitionieren 6 s lang auf.
- **Flugzeugträger:** 3 eigene Jets; ersetzt einen verlorenen alle 22 s und schickt sie
  selbstständig gegen sichtbare Ziele im Umkreis von 17 Feldern.
- **Landungsschiff:** 5 Plätze für Bodeneinheiten. Einsteigen am Ufer; auf Land geschickt, legt es
  am nächsten Ufer an und setzt die Truppen ab. Sinkt es, sterben die Insassen.
- **Marine-Dreieck:** Korvette schlägt Schnellboot, Schnellboot unterläuft die Mindestreichweite
  (6) des Zerstörers, Zerstörer schlägt Korvette auf Distanz.

## 8. Rollen (Ergebnis der Balance-Simulation)

Gleich teure Gruppen (je 3000 Credits) gegeneinander, mehrere Karten, Seiten getauscht:

| Einheit | schlägt | unterliegt |
| --- | --- | --- |
| Schütze | Panzerabwehr, Scharfschützen (offen), Hubschrauber | Fahrzeugen |
| Panzerabwehrtrupp | Kampfpanzer, Flak, Hubschrauber, Spähwagen | Infanterie, Artillerie |
| Scharfschütze | Infanterie aus der Deckung (verteidigend) | allem in offener Feldschlacht |
| Spähwagen | Infanterie, Flak, Raketenwerfer | Schützen- und Kampfpanzern, Hubschrauber |
| Schützenpanzer | Infanterie, Spähwagen, Flak, Artillerie | Kampfpanzer, Hubschrauber |
| Kampfpanzer | fast alles am Boden | Panzerabwehr, Hubschrauber |
| Flakpanzer | Hubschrauber, Infanterie, Artillerie | Panzern, Panzerabwehr |
| Rohr-/Raketenartillerie | allem, was auf sie zukommt (aus der Stellung) | schnellen Fahrzeugen im Nahbereich |
| Kampfhubschrauber | Fahrzeugen, Artillerie | Flak, Panzerabwehr, Schützen |
| Mörsertrupp (geplant) | Infanterie | Fahrzeugen, Scharfschützen |

## 9. Geplant für die Godot-Version

- **Mörsertrupp:** Steilfeuer (Artillerie-Klasse), Reichweite 9, Mindestreichweite 2,5.
- **Sanitäter:** unbewaffnet, heilt Infanterie im Umkreis von 2,5 Feldern um 6 Lebenspunkte pro Sekunde.
- **Touch-Steuerung:** Tippen wählt aus bzw. gibt einen Befehl, ein Knopf schaltet auf „Rahmen ziehen“,
  ein Finger schiebt die Karte, zwei Finger zoomen.
