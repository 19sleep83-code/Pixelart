#!/usr/bin/env python3
"""Placeholder sounds for Pixelfront, synthesised so that every sound event already has a file.

Writes 16-bit mono WAVs (22.05 kHz) and sounds.json (event -> files, volume, pitch spread,
max voices, positional) into the given folder. Replace any WAV later by a real recording of the
same name; nothing else has to change.

    python3 tools/sounds.py godot/assets/sounds
"""
import json
import os
import sys
import wave

import numpy as np

SR = 22050
rng = np.random.default_rng(7)


def env(n, attack=0.004, decay=0.2, sustain=0.0):
    t = np.arange(n) / SR
    a = np.clip(t / max(attack, 1e-4), 0, 1)
    d = np.exp(-t / max(decay, 1e-4))
    return a * (sustain + (1 - sustain) * d)


def noise(n):
    return rng.uniform(-1, 1, n)


def lowpass(x, k):
    """a one-pole low pass; k in (0,1], smaller is darker"""
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc += k * (v - acc)
        y[i] = acc
    return y


def tone(freq, dur, kind='sine'):
    t = np.arange(int(SR * dur)) / SR
    if kind == 'square':
        return np.sign(np.sin(2 * np.pi * freq * t))
    return np.sin(2 * np.pi * freq * t)


def sweep(f0, f1, dur):
    t = np.arange(int(SR * dur)) / SR
    f = np.linspace(f0, f1, len(t))
    return np.sin(2 * np.pi * np.cumsum(f) / SR)


def norm(x, peak=0.9):
    m = np.max(np.abs(x)) or 1
    return x / m * peak


def write(folder, name, x):
    x = np.clip(norm(x), -1, 1)
    data = (x * 32767).astype('<i2').tobytes()
    with wave.open(os.path.join(folder, name), 'wb') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(data)


def shot(dur, bright, body, crack=0.0):
    n = int(SR * dur)
    x = lowpass(noise(n), bright) * env(n, 0.001, dur * 0.25)
    x += body * lowpass(noise(n), 0.03) * env(n, 0.002, dur * 0.5)
    if crack:
        m = int(SR * 0.012)
        x[:m] += crack * noise(m)
    return x


def boom(dur, depth):
    n = int(SR * dur)
    rumble = lowpass(noise(n), depth) * env(n, 0.003, dur * 0.35)
    thump = sweep(90, 30, dur)[:n] * env(n, 0.002, 0.12)
    return rumble * 1.4 + thump * 0.8


def main(folder):
    os.makedirs(folder, exist_ok=True)
    S = {}

    def add(event, files, vol=0.0, pitch=0.08, voices=4, positional=True, desc=''):
        S[event] = {'files': files, 'volumeDb': vol, 'pitchSpread': pitch, 'maxVoices': voices, 'positional': positional, 'desc': desc}

    # ── weapons (event = the projectile kind the game reports)
    for i in range(3):
        write(folder, f'shot_bullet_{i}.wav', shot(0.12, 0.6, 0.2, 0.6))
    add('bullet', [f'shot_bullet_{i}.wav' for i in range(3)], -10, 0.12, 6, True, 'MG und Gewehre: kurzer Knall, mehrere Varianten')
    write(folder, 'shot_snipe.wav', shot(0.35, 0.8, 0.3, 1.0))
    add('snipe', ['shot_snipe.wav'], -4, 0.05, 2, True, 'Scharfschützengewehr: lauter, scharfer Knall mit Hall')
    for i in range(2):
        write(folder, f'shot_shell_{i}.wav', shot(0.45, 0.25, 0.9, 0.5))
    add('shell', ['shot_shell_0.wav', 'shot_shell_1.wav'], -3, 0.1, 4, True, 'Panzerkanone / Maschinenkanone: tiefer Abschuss')
    write(folder, 'shot_flak.wav', np.concatenate([shot(0.07, 0.5, 0.4, 0.4) for _ in range(4)]))
    add('flak', ['shot_flak.wav'], -8, 0.08, 3, True, 'Flak: schnelle Viererserie')
    write(folder, 'shot_rocket.wav', lowpass(noise(int(SR * 0.6)), 0.3) * env(int(SR * 0.6), 0.02, 0.3, 0.2))
    add('rocket', ['shot_rocket.wav'], -6, 0.1, 4, True, 'Panzerabwehrrakete: Zischen beim Start')
    write(folder, 'shot_art.wav', shot(1.0, 0.1, 1.2, 0.3))
    add('art', ['shot_art.wav'], 0, 0.06, 3, True, 'Haubitze: schwerer, langer Abschuss')
    write(folder, 'shot_mlrs.wav', np.concatenate([lowpass(noise(int(SR * 0.18)), 0.25) * env(int(SR * 0.18), 0.01, 0.1) for _ in range(6)]))
    add('mlrs', ['shot_mlrs.wav'], -2, 0.06, 2, True, 'Raketenwerfer: rasche Folge von Starts')
    write(folder, 'shot_missile.wav', lowpass(noise(int(SR * 1.2)), 0.2) * env(int(SR * 1.2), 0.05, 0.8, 0.3))
    add('missile', ['shot_missile.wav'], -2, 0.05, 3, True, 'Marschflugkörper / Jet-Raketen: langes Rauschen')
    # ── impacts
    for i in range(2):
        write(folder, f'hit_{i}.wav', shot(0.2, 0.4, 0.5, 0.8))
    add('hit', ['hit_0.wav', 'hit_1.wav'], -6, 0.15, 5, True, 'Treffer auf Panzerung: metallischer Schlag')
    for i in range(3):
        write(folder, f'boom_{i}.wav', boom(1.4 + i * 0.3, 0.05 + i * 0.01))
    add('boom', [f'boom_{i}.wav' for i in range(3)], 0, 0.12, 6, True, 'Einschlag von Artillerie, Raketen, Granaten')
    big = boom(2.2, 0.04)
    crack = shot(0.6, 0.6, 0.0, 1.0)
    big[:len(crack)] += 0.5 * crack
    write(folder, 'explode.wav', big)
    add('explode', ['explode.wav'], 2, 0.08, 4, True, 'Fahrzeug, Flugzeug oder Schiff explodiert')
    write(folder, 'collapse.wav', np.concatenate([boom(1.0, 0.05), lowpass(noise(int(SR * 2.0)), 0.06) * env(int(SR * 2.0), 0.1, 1.0)]))
    add('collapse', ['collapse.wav'], 3, 0.05, 2, True, 'Gebäude stürzt ein: Explosion und Poltern')
    write(folder, 'scream.wav', sweep(700, 300, 0.4) * env(int(SR * 0.4), 0.02, 0.25) * 0.5)
    add('scream', ['scream.wav'], -12, 0.2, 2, True, 'Soldat fällt (Platzhalter; echter Ruf sparsam einsetzen)')
    # ── orders and interface
    write(folder, 'ui_ack.wav', tone(880, 0.06) * env(int(SR * 0.06), 0.002, 0.03))
    add('ack', ['ui_ack.wav'], -10, 0.03, 1, False, 'Befehl bestätigt (später: Sprachbestätigung „Verstanden“, „Bewegung“ …)')
    write(folder, 'ui_unit.wav', np.concatenate([tone(660, 0.07), tone(990, 0.09)]) * 0.6)
    add('unit', ['ui_unit.wav'], -8, 0.0, 1, False, 'Einheit fertig ausgebildet / gebaut')
    write(folder, 'ui_ready.wav', np.concatenate([tone(523, 0.08), tone(659, 0.08), tone(784, 0.12)]) * 0.6)
    add('ready', ['ui_ready.wav'], -8, 0.0, 1, False, 'Gebäude bereit zum Platzieren')
    write(folder, 'ui_place.wav', boom(0.4, 0.15) * 0.6)
    add('place', ['ui_place.wav'], -6, 0.05, 1, True, 'Gebäude gesetzt: dumpfer Aufschlag, Baulärm')
    write(folder, 'ui_sell.wav', np.concatenate([tone(784, 0.06), tone(523, 0.1)]) * 0.6)
    add('sell', ['ui_sell.wav'], -8, 0.0, 1, False, 'Gebäude verkauft')
    write(folder, 'ui_alert.wav', np.concatenate([tone(880, 0.15, 'square'), tone(660, 0.15, 'square')] * 2) * 0.35)
    add('alert', ['ui_alert.wav'], -6, 0.0, 1, False, 'Basis / Einheiten werden angegriffen (später Funkspruch)')
    write(folder, 'ui_promote.wav', np.concatenate([tone(659, 0.08), tone(784, 0.08), tone(1047, 0.16)]) * 0.6)
    add('promote', ['ui_promote.wav'], -8, 0.0, 1, False, 'Beförderung')
    write(folder, 'ui_capture.wav', np.concatenate([tone(392, 0.1), tone(523, 0.1), tone(659, 0.2)]) * 0.6)
    add('capture', ['ui_capture.wav'], -6, 0.0, 1, True, 'Gebäude erobert')
    write(folder, 'board.wav', lowpass(noise(int(SR * 0.3)), 0.2) * env(int(SR * 0.3), 0.01, 0.1))
    add('board', ['board.wav'], -10, 0.1, 2, True, 'Einsteigen (Schritte, Luke)')
    add('unload', ['board.wav'], -10, 0.1, 2, True, 'Aussteigen / Rampe')
    write(folder, 'jet_flyby.wav', lowpass(noise(int(SR * 2.5)), 0.12) * np.hanning(int(SR * 2.5)))
    add('jet', ['jet_flyby.wav'], 0, 0.06, 2, True, 'Jet startet / überfliegt')
    # ── loops the game should add (engine sounds, weather, sea)
    def loop(name, x):
        write(folder, name, x)
    loop('loop_tank.wav', lowpass(noise(SR * 2), 0.04) * 0.6 + 0.3 * tone(55, 2.0, 'square') * 0.2)
    add('loop_tank', ['loop_tank.wav'], -16, 0.05, 6, True, 'Motor und Ketten fahrender Kettenfahrzeuge (Schleife)')
    loop('loop_rotor.wav', lowpass(noise(SR * 2), 0.08) * (0.6 + 0.4 * np.sign(np.sin(2 * np.pi * 18 * np.arange(SR * 2) / SR))))
    add('loop_rotor', ['loop_rotor.wav'], -14, 0.05, 4, True, 'Hubschrauber-Rotor (Schleife)')
    loop('loop_rain.wav', lowpass(noise(SR * 3), 0.5) * 0.5)
    add('loop_rain', ['loop_rain.wav'], -14, 0.0, 1, False, 'Regen (Schleife, je nach Wetter)')
    loop('loop_wind.wav', lowpass(noise(SR * 4), 0.02) * (0.7 + 0.3 * np.sin(np.linspace(0, 6.28, SR * 4))))
    add('loop_wind', ['loop_wind.wav'], -20, 0.0, 1, False, 'Wind über dem Land (Grundgeräusch)')
    loop('loop_sea.wav', lowpass(noise(SR * 4), 0.05) * (0.6 + 0.4 * np.sin(np.linspace(0, 12.56, SR * 4))))
    add('loop_sea', ['loop_sea.wav'], -18, 0.0, 1, True, 'Brandung an der Küste (Schleife)')
    write(folder, 'thunder.wav', boom(3.0, 0.02))
    add('thunder', ['thunder.wav'], -2, 0.1, 1, False, 'Donner nach einem Blitz')
    with open(os.path.join(folder, 'sounds.json'), 'w', encoding='utf-8') as f:
        json.dump({'note': 'Platzhalter-Töne. Jede WAV kann durch eine echte Aufnahme gleichen Namens ersetzt werden.', 'events': S}, f, ensure_ascii=False, indent=1)
    print(len(S), 'Ereignisse,', len([n for n in os.listdir(folder) if n.endswith('.wav')]), 'Dateien')


if __name__ == '__main__':
    main(sys.argv[1] if len(sys.argv) > 1 else 'sounds')
