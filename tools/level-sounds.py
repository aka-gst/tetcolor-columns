#!/usr/bin/env python3
"""Приводит папку звуков к одной громкости и печатает таблицу «до и после».

Зачем. Сейчас в игре сорок три множителя, подобранных вручную, от ×0.083 до
×4.877 — они выравнивают записи, сделанные в разное время и с разного
расстояния до микрофона. Множители работают, но из-за них громкость файла
ничего не говорит о громкости в игре, и разговор об этом за один день дважды
ушёл не туда. Если записи сделаны за один присест, выравнивать их должен один
проход здесь, а таблица в коде — стоять на единицах.

    python3 tools/level-sounds.py public/sounds --apply

Без --apply только показывает, что получится. Разница по ролям (ход тише,
сбор линии заметнее) живёт в MOMENT_GAIN и сюда не относится: это про моменты,
а не про файлы.
"""
import argparse, math, os, struct, subprocess, sys, statistics

def measure(path):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '48000', '-'],
        capture_output=True).stdout
    count = len(raw) // 4
    if not count:
        return 0.0, 0.0
    values = struct.unpack(f'<{count}f', raw[:count * 4])
    total = 0.0
    peak = 0.0
    for value in values:
        total += value * value
        size = abs(value)
        if size > peak:
            peak = size
    return math.sqrt(total / count), peak

def db(value):
    return 20 * math.log10(max(value, 1e-9))

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder')
    parser.add_argument('--target', type=float, default=0.021,
                        help='опорная громкость (RMS). По умолчанию — та, на которой стоит игра')
    parser.add_argument('--peak', type=float, default=0.7,
                        help='потолок пика после усиления')
    parser.add_argument('--apply', action='store_true', help='переписать файлы, а не только показать')
    args = parser.parse_args()

    files = sorted(
        os.path.join(root, name)
        for root, _, names in os.walk(args.folder)
        for name in names if name.endswith('.mp3'))
    if not files:
        sys.exit('в папке нет mp3')

    print(f'{"файл":<28}{"было, дБ":>10}{"усиление":>10}{"станет, дБ":>12}{"пик":>8}')
    after = []
    for path in files:
        rms, peak = measure(path)
        if rms <= 0:
            print(f'{os.path.relpath(path, args.folder):<28}  тишина, пропускаю')
            continue
        gain = args.target / rms
        # Пик важнее опорной громкости: клиппинг слышен, а полдецибела — нет.
        if peak * gain > args.peak:
            gain = args.peak / peak
        after.append(db(rms * gain))
        print(f'{os.path.relpath(path, args.folder):<28}{db(rms):>10.1f}{gain:>10.3f}{db(rms * gain):>12.1f}{peak * gain:>8.3f}')
        if args.apply:
            temp = path + '.tmp.mp3'
            subprocess.run(['ffmpeg', '-v', 'error', '-i', path, '-af', f'volume={gain:.4f}',
                            '-codec:a', 'libmp3lame', '-q:a', '4', '-y', temp], check=True)
            os.replace(temp, path)

    if after:
        print(f'\nразброс после: {max(after) - min(after):.1f} дБ '
              f'(в игре останется только разница по моментам)')
    if not args.apply:
        print('это была примерка. Чтобы переписать файлы, добавьте --apply')

if __name__ == '__main__':
    main()
