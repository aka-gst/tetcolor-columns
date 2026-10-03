#!/usr/bin/env python3
"""Пересчитывает CRUSH_TRIM — поправку громкости для эффекта «искажение».

Искажение нелинейно: насколько оно поднимает звук, зависит от уровня самого
звука. Поэтому таблица меряется по файлам (RMS сухого / RMS искажённого) и
обязана пересчитываться после любой смены уровней файлов — иначе редкий бонус
с эффектом выпрыгивает.

    python3 tools/crush-trim.py public/sounds            печатает таблицу для вставки в page.tsx
    python3 tools/crush-trim.py public/sounds --compare   сравнивает с тем, что сейчас в page.tsx

Кривая — та же, что CRUSH_CURVE в app/page.tsx; WaveShaper в WebAudio берёт
точку кривой линейной интерполяцией по входу, зажатому в [−1, 1].
"""
import math, os, re, struct, subprocess, sys

N = 1024
CURVE = [((3 + 45) * ((i * 2) / N - 1) * 20 * math.pi / 180) / (math.pi + 45 * abs((i * 2) / N - 1)) for i in range(N)]


def shape(x):
    x = max(-1.0, min(1.0, x))
    pos = (x + 1) / 2 * (N - 1)
    i = int(pos)
    if i >= N - 1:
        return CURVE[N - 1]
    f = pos - i
    return CURVE[i] * (1 - f) + CURVE[i + 1] * f


def decode(path):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'],
                         capture_output=True, check=True).stdout
    n = len(raw) // 4
    return struct.unpack(f'<{n}f', raw[:n * 4])


def rms(xs):
    return math.sqrt(sum(x * x for x in xs) / len(xs)) if xs else 0.0


def trims(folder):
    out = {}
    for root, _, names in os.walk(folder):
        for name in sorted(names):
            if not name.endswith('.mp3'):
                continue
            path = os.path.join(root, name)
            dry = decode(path)
            wet = [shape(x) for x in dry]
            out[os.path.relpath(path, folder)] = rms(dry) / rms(wet) if rms(wet) > 0 else 1.0
    return out


def current_table():
    page = open(os.path.join(os.path.dirname(__file__), '..', 'app', 'page.tsx'), encoding='utf-8').read()
    block = re.search(r'const CRUSH_TRIM: Record<string, number> = \{([\s\S]*?)\n\};', page).group(1)
    return {m.group(1): float(m.group(2)) for m in re.finditer(r"'([^']+)': ([0-9.]+)", block)}


def main():
    folder = sys.argv[1]
    compare = '--compare' in sys.argv
    new = trims(folder)
    old = current_table() if compare else {}
    order = ['clear-1.mp3', 'clear-2.mp3', 'cycle-1.mp3', 'cycle-2.mp3', 'gameover-1.mp3', 'gameover-2.mp3', 'land-1.mp3', 'land-2.mp3',
             'level-1.mp3', 'move-1.mp3', 'move-2.mp3'] + [f'eggs/egg-{i}.mp3' for i in range(1, 16)] + [f'custom/custom-{i}.mp3' for i in range(1, 18)]
    for name in order:
        if compare:
            o = old.get(name)
            print(f"  '{name}': {new[name]:.3f},   // было {o:.3f}  ({20*math.log10(new[name]/o):+.1f} дБ)" if o else f"  '{name}': {new[name]:.3f},")
        else:
            print(f"  '{name}': {new[name]:.3f},")


if __name__ == '__main__':
    main()
