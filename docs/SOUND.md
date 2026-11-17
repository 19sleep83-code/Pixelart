# Pixelfront – Ton

Alles, was im Spiel klingen soll, mit Platzhalter-Tönen, damit die Godot-Version von Anfang an Ton
hat. Die Platzhalter erzeugt `tools/sounds.py` (synthetisch: Rauschen, Töne, Hüllkurven) nach
`godot/assets/sounds/`. Jede WAV-Datei lässt sich durch eine echte Aufnahme mit **gleichem Namen**
ersetzen; die Zuordnung in `sounds.json` (Lautstärke, Tonhöhen-Streuung, Höchstzahl gleichzeitiger
Stimmen, räumlich ja/nein) bleibt.

## Ereignisse, die das Spiel schon auslöst

| Ereignis | Wann | Klang (Vorschlag) |
| --- | --- | --- |
| `bullet` | MG, Gewehre, Maschinenkanonen mit Geschossen | kurzer Knall, 3 Varianten |
| `snipe` | Scharfschütze | scharfer Knall mit Nachhall |
| `shell` | Panzer- und Maschinenkanone | tiefer Abschuss, 2 Varianten |
| `flak` | Flakpanzer, Träger-Flak | schnelle Viererserie |
| `rocket` | Panzerabwehr, Hubschrauber, Raketenstellung | Zischen beim Start |
| `art` | Haubitze | schwerer, langer Abschuss |
| `mlrs` | Raketenwerfer | rasche Folge von Starts |
| `missile` | Zerstörer, Jets | langes Rauschen |
| `hit` | Treffer auf Panzerung | metallischer Schlag |
| `boom` | Einschlag mit Flächenschaden | Explosion, 3 Varianten |
| `explode` | Fahrzeug, Flugzeug, Schiff zerstört | große Explosion |
| `collapse` | Gebäude zerstört | Explosion und Poltern |
| `scream` | Soldat fällt | kurzer Ruf (sparsam) |
| `ack` | Befehl gegeben | Klick (später Sprache) |
| `unit` | Einheit fertig | Signal |
| `ready` | Gebäude bereit zum Platzieren | Dreiklang |
| `place` | Gebäude gesetzt | dumpfer Aufschlag |
| `sell` | Gebäude verkauft | fallender Zweiklang |
| `alert` | Angriff auf Basis oder Einheiten | Alarmton |
| `promote` | Beförderung | aufsteigender Dreiklang |
| `capture` | Gebäude erobert | Fanfare |
| `board` / `unload` | Ein- und Aussteigen | Schritte, Luke, Rampe |
| `jet` | Jet startet | Vorbeiflug |

## Noch einzubauen (Dateien liegen bereit)

| Ereignis | Wann | Klang |
| --- | --- | --- |
| `loop_tank` | Kettenfahrzeug fährt (Schleife, leiser im Stand) | Motor und Ketten |
| `loop_rotor` | Hubschrauber in der Luft | Rotor |
| `loop_rain` | Wetter Regen | Regen |
| `loop_wind` | immer, ganz leise | Wind |
| `loop_sea` | Kamera an der Küste | Brandung |
| `thunder` | Blitz bei Regen, 1–3 s später | Donner |

## Funksprüche (für Sprachaufnahmen)

Kurz, ruhig, militärisch – eine Stimme je Seite (deutsch für beide Seiten, Akzent optional):

- „Gefechtsstand bereit.“ · „Bau abgeschlossen.“ · „Einheit bereit.“ · „Nicht genug Rohstoffe.“
- „Unsere Basis wird angegriffen!“ · „Unsere Einheiten werden angegriffen!“
- „Gebäude zerstört.“ · „Gebäude erobert.“ · „Wir haben ein Gebäude verloren!“
- „Feindliche Truppen rücken vor!“ · „Haus besetzt.“ · „Jets werden aufmunitioniert.“
- Bestätigungen bei Befehlen (je 3–4 Varianten): „Verstanden.“ · „Bewegung.“ · „Ziel erfasst.“ ·
  „Feuer frei.“ · „Steigen ein.“ · „Halten Stellung.“

## Musik

- **Menü:** getragen, Marschtrommel und tiefe Streicher, 2–3 Minuten, Schleife.
- **Gefecht ruhig / angespannt:** zwei Ebenen, die je nach Kampflage überblendet werden.
- **Sieg / Niederlage:** je ein kurzer Abschluss (10–20 s).
