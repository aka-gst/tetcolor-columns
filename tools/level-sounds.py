#!/usr/bin/env python3
"""Меряет громкость всех звуков числом и приводит их к одному уровню.

    python3 tools/level-sounds.py public/sounds                      таблица «как есть»
    python3 tools/level-sounds.py sounds-original --apply public/sounds   выровнять: читать из первой папки, писать во вторую
    python3 tools/level-sounds.py --samoproverka                     отрицательный контроль измерителя
    python3 tools/level-sounds.py public/sounds --json trash/zamer.json  то же плюс JSON для страницы выбора

Мера — RMS-пик: наибольший RMS в окне 2048 отсчётов при 48 кГц (43 мс) с шагом
10 мс. Ровно это же меряет пульт игры (AnalyserNode, fftSize 2048, максимум
по семи снимкам), поэтому числа отсюда и с живой страницы сравнимы напрямую.
LUFS (EBU R128) печатается рядом, но для файлов короче 0.4 с он не определён —
у нас таких четыре, — и целиться в него нельзя (навык zvuk, 7.09.2026).

Цель: RMS-пик −16 дБFS, истинный пик не выше −1 дБTP. Если потолок пика
не даёт дотянуть до цели — файл поднимается до потолка, и это видно в таблице.
Разница по ролям (ход тише на 5 дБ) живёт в MOMENT_GAIN в коде и сюда не
относится: это про моменты, а не про файлы.

Оригиналы не трогаются: читаем из одной папки, пишем в другую.
"""
import argparse, json, math, os, re, struct, subprocess, sys, tempfile

WINDOW = 2048   # отсчётов при 48 кГц — как fftSize у пульта игры
HOP = 480       # 10 мс
RATE = 48000
TARGET_DB = -16.0
PEAK_CAP_DB = -1.0


def decode(path, rate=RATE):
    raw = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', str(rate), '-'],
        capture_output=True, check=True).stdout
    count = len(raw) // 4
    return struct.unpack(f'<{count}f', raw[:count * 4]) if count else ()


def db(value):
    return -math.inf if value <= 0 else 20 * math.log10(value)


def rms_peak(samples):
    """Наибольший RMS по окнам WINDOW с шагом HOP. Короче окна — одно окно на весь файл."""
    n = len(samples)
    if n == 0:
        return 0.0
    if n <= WINDOW:
        return math.sqrt(sum(s * s for s in samples) / n)
    squares = [s * s for s in samples]
    prefix = [0.0] * (n + 1)
    acc = 0.0
    for i, q in enumerate(squares):
        acc += q
        prefix[i + 1] = acc
    best = 0.0
    for start in range(0, n - WINDOW + 1, HOP):
        energy = prefix[start + WINDOW] - prefix[start]
        if energy > best:
            best = energy
    return math.sqrt(best / WINDOW)


def rms_floor(samples):
    """Самое тихое окно — пол файла: шум комнаты, который поднимается вместе со звуком."""
    n = len(samples)
    if n <= WINDOW:
        return 0.0
    worst = math.inf
    for start in range(0, n - WINDOW + 1, HOP):
        energy = sum(s * s for s in samples[start:start + WINDOW])
        if energy < worst:
            worst = energy
    return math.sqrt(worst / WINDOW)


def lufs(path):
    out = subprocess.run(['ffmpeg', '-v', 'info', '-i', path, '-af', 'ebur128', '-f', 'null', '-'],
                         capture_output=True, text=True).stderr
    summary = out[out.rfind('Summary:'):]
    m = re.search(r'\bI:\s*(-?[\d.]+|-inf)\s*LUFS', summary)
    if not m:
        return None
    value = float(m.group(1)) if m.group(1) != '-inf' else -math.inf
    return None if value <= -70 else value


def measure(path):
    samples = decode(path)
    seconds = len(samples) / RATE
    peak = max((abs(s) for s in samples), default=0.0)
    # Истинный пик: тот же файл, пересчитанный на 192 кГц — между отсчётами бывает выше.
    true_peak = max((abs(s) for s in decode(path, 192000)), default=0.0)
    full = math.sqrt(sum(s * s for s in samples) / len(samples)) if samples else 0.0
    return {
        'floor_db': db(rms_floor(samples)),
        'seconds': round(seconds, 3),
        'peak_db': db(peak),
        'true_peak_db': db(true_peak),
        'rms_db': db(full),
        'rms_peak_db': db(rms_peak(samples)),
        'lufs': lufs(path) if seconds >= 0.4 else None,
    }


def plan_gain(m, target_db=TARGET_DB, cap_db=PEAK_CAP_DB):
    """Усиление в дБ: к цели по RMS-пику, но не выше потолка по истинному пику."""
    if m['rms_peak_db'] == -math.inf:
        return 0.0
    gain = target_db - m['rms_peak_db']
    if m['true_peak_db'] + gain > cap_db:
        gain = cap_db - m['true_peak_db']
    return gain


def apply_gain(src, dst, gain_db):
    os.makedirs(os.path.dirname(dst) or '.', exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-af', f'volume={gain_db:.3f}dB',
                    '-codec:a', 'libmp3lame', '-q:a', '2', dst], check=True)


def fmt(value, width=7, digits=1):
    if value is None:
        return f'{"—":>{width}}'
    if value == -math.inf:
        return f'{"тишина":>{width}}'
    return f'{value:>{width}.{digits}f}'


def list_files(folder):
    return sorted(os.path.relpath(os.path.join(root, name), folder)
                  for root, _, names in os.walk(folder) for name in names if name.endswith('.mp3'))


def table(rows, title):
    print(f'\n{title}')
    print(f'{"файл":<24}{"сек":>6}{"пик":>8}{"ист.пик":>8}{"RMS":>8}{"RMS-пик":>8}{"пол":>8}{"LUFS":>7}')
    for name, m in rows:
        print(f'{name:<24}{m["seconds"]:>6.2f}{fmt(m["peak_db"], 8)}{fmt(m["true_peak_db"], 8)}'
              f'{fmt(m["rms_db"], 8)}{fmt(m["rms_peak_db"], 8)}{fmt(m["floor_db"], 8)}{fmt(m["lufs"], 7)}')
    values = [m['rms_peak_db'] for _, m in rows if m['rms_peak_db'] != -math.inf]
    if values:
        print(f'{"разброс RMS-пика":<24}{max(values) - min(values):>6.1f} дБ  '
              f'(от {min(values):.1f} до {max(values):.1f}); истинный пик наибольший '
              f'{max(m["true_peak_db"] for _, m in rows):.1f} дБTP')


def samoproverka():
    """Измеритель проверяется там, где ответ известен заранее (правило 7л)."""
    failures = []
    with tempfile.TemporaryDirectory() as tmp:
        silent = os.path.join(tmp, 'silence.mp3')
        sine = os.path.join(tmp, 'sine.mp3')
        burst = os.path.join(tmp, 'burst.mp3')
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-t', '0.6',
                        '-codec:a', 'libmp3lame', '-q:a', '2', silent], check=True)
        # Синус с пиком ровно 0.1 (−20 дБFS): RMS = пик − 3.01 дБ. Амплитуда задаётся
        # явно: у lavfi `sine` она по умолчанию 1/8 (−18 дБ), и первый вариант этого
        # контроля на том и погорел — все ожидания уехали на 18 дБ.
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'aevalsrc=0.1*sin(2*PI*1000*t):s=44100:c=mono', '-t', '1.0',
                        '-codec:a', 'libmp3lame', '-q:a', '2', sine], check=True)
        # Всплеск 50 мс с пиком 0.3162 (−10 дБFS) в середине секунды тишины:
        # RMS-пик обязан видеть всплеск, а не среднее по файлу.
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', r'aevalsrc=0.3162*sin(2*PI*1000*t)*between(t\,0.5\,0.55):s=44100:c=mono', '-t', '1.0',
                        '-codec:a', 'libmp3lame', '-q:a', '2', burst], check=True)
        s = measure(silent)
        if s['rms_peak_db'] > -60:
            failures.append(f'тишина даёт RMS-пик {s["rms_peak_db"]:.1f}, а должна быть ниже −60')
        t = measure(sine)
        if abs(t['rms_peak_db'] - (-23.0)) > 0.3:
            failures.append(f'синус −20 дБ пик: RMS-пик {t["rms_peak_db"]:.2f}, ожидалось −23.0 ± 0.3')
        if abs(t['peak_db'] - (-20.0)) > 0.3:
            failures.append(f'синус −20 дБ пик: пик {t["peak_db"]:.2f}, ожидалось −20.0 ± 0.3')
        if t['lufs'] is None or abs(t['lufs'] - (-23.0)) > 1.0:
            failures.append(f'синус −20 дБ: LUFS {t["lufs"]}, ожидалось около −23')
        b = measure(burst)
        if abs(b['rms_peak_db'] - (-13.0)) > 0.8:
            failures.append(f'всплеск 50 мс −10 дБ: RMS-пик {b["rms_peak_db"]:.2f}, ожидалось −13.0 ± 0.8')
        if b['rms_db'] > -20:
            failures.append(f'всплеск: средний RMS {b["rms_db"]:.1f} — должен быть много ниже RMS-пика, иначе окно не работает')
        g = plan_gain(t)
        if abs(g - 7.0) > 0.3:
            failures.append(f'план усиления для синуса: {g:.2f} дБ, ожидалось +7.0 (−23 → −16)')
        g2 = plan_gain(b)
        if abs(g2 - (-3.0)) > 0.8:
            failures.append(f'план усиления для всплеска: {g2:.2f} дБ, ожидалось −3.0 (RMS-пик −13 → цель −16; потолок пика тут не при чём)')
        # Потолок: тот же всплеск, но цель задрана до −2 — дотянуть мешает истинный пик (−10 → −1 = +9, а не +11).
        g3 = plan_gain(b, target_db=-2.0)
        if abs(g3 - 9.0) > 0.8:
            failures.append(f'потолок пика: план {g3:.2f} дБ, ожидалось +9.0 (упор в −1 дБTP)')
        # Применение: после усиления файл обязан померяться там, куда целились.
        out = os.path.join(tmp, 'sine-out.mp3')
        apply_gain(sine, out, g)
        after = measure(out)
        if abs(after['rms_peak_db'] - TARGET_DB) > 0.3:
            failures.append(f'после применения синус дал RMS-пик {after["rms_peak_db"]:.2f}, ожидалось {TARGET_DB}')
    if failures:
        print('САМОПРОВЕРКА НЕ ПРОШЛА:')
        for f in failures:
            print('  -', f)
        sys.exit(1)
    print('самопроверка: тишина → тишина; синус −20 дБ → RMS-пик −23.0, LUFS ≈ −23; всплеск 50 мс виден; усиление сходится к цели. OK')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('folder', nargs='?', help='папка со звуками (откуда читать)')
    parser.add_argument('--apply', metavar='КУДА', help='записать выровненные копии в эту папку')
    parser.add_argument('--target', type=float, default=TARGET_DB, help='цель по RMS-пику, дБFS')
    parser.add_argument('--cap', type=float, default=PEAK_CAP_DB, help='потолок истинного пика, дБTP')
    parser.add_argument('--json', help='куда сложить замеры (до, план, после) в JSON')
    parser.add_argument('--samoproverka', action='store_true')
    args = parser.parse_args()

    if args.samoproverka:
        samoproverka()
        return
    if not args.folder:
        parser.error('укажите папку или --samoproverka')

    files = list_files(args.folder)
    if not files:
        sys.exit('в папке нет mp3')

    before = [(name, measure(os.path.join(args.folder, name))) for name in files]
    table(before, f'ДО — {args.folder}')

    report = {'target_db': args.target, 'cap_db': args.cap, 'files': {}}
    for name, m in before:
        report['files'][name] = {'before': m, 'gain_db': plan_gain(m, args.target, args.cap)}

    if args.apply:
        print(f'\nприменяю: {args.folder} → {args.apply}')
        for name, m in before:
            apply_gain(os.path.join(args.folder, name), os.path.join(args.apply, name), report['files'][name]['gain_db'])
        after = [(name, measure(os.path.join(args.apply, name))) for name in files]
        for name, m in after:
            report['files'][name]['after'] = m
        table(after, f'ПОСЛЕ — {args.apply}')
        print(f'\n{"файл":<24}{"усиление":>9}{"RMS-пик до":>11}{"после":>7}')
        for name, _ in before:
            r = report['files'][name]
            print(f'{name:<24}{r["gain_db"]:>+9.1f}{fmt(r["before"]["rms_peak_db"], 11)}{fmt(r["after"]["rms_peak_db"], 7)}')
    else:
        print(f'\nплан (цель {args.target} дБFS по RMS-пику, потолок {args.cap} дБTP):')
        for name, m in before:
            g = report['files'][name]['gain_db']
            print(f'{name:<24}{g:>+7.1f} дБ → RMS-пик {fmt(m["rms_peak_db"] + g, 6)}')
        print('\nэто была примерка. Чтобы записать копии: --apply <папка>')

    if args.json:
        os.makedirs(os.path.dirname(args.json) or '.', exist_ok=True)
        with open(args.json, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=1, default=lambda v: None if v == -math.inf else v)
        print(f'\nJSON: {args.json}')


if __name__ == '__main__':
    main()
