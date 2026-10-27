#!/usr/bin/env python3
"""Собирает страницу выбора звуков: шаблон + замеры → index.html.

    python3 tools/vybor-zvukov/sobrat.py trash/zamer.json

Данные по файлу: где используется (из SOUND_FILES в app/page.tsx — один
источник, без копии), RMS-пик до и после, усиление. Страница публикуется
артефактом, выбор уходит в его хранилище по клику (правило 30е).
"""
import json, math, os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, '..', '..'))
page = open(os.path.join(ROOT, 'app', 'page.tsx'), encoding='utf-8').read()

labels = dict(re.findall(r"(\w+): '([^']+)'", re.search(r'const SOUND_LABELS[^{]*\{([\s\S]*?)\n\};', page).group(1)))
block = re.search(r'const SOUND_FILES[^{]*\{([\s\S]*?)\n\};', page).group(1)
uses = {}
for moment, files in re.findall(r"^\s*(\w+): \[([^\]]*)\]", block, re.M):
    for f in re.findall(r"'sounds/([^'?]+)", files):
        uses.setdefault(f, []).append(labels[moment])

zamer = json.load(open(sys.argv[1], encoding='utf-8'))
groups = [('ОБЫЧНЫЕ', lambda n: '/' not in n), ('РЕДКИЕ (ПАСХАЛКИ)', lambda n: n.startswith('eggs/')), ('ВАШИ ЗАПИСИ', lambda n: n.startswith('custom/'))]
def key(n):  # eggs/egg-10.mp3 → egg-10 ; порядок по числу
    m = re.search(r'(\D+)-(\d+)', n); return (m.group(1), int(m.group(2)))
rows = []
for title, test in groups:
    names = sorted([n for n in zamer['files'] if test(n)], key=key)
    for n in names:
        r = zamer['files'][n]
        moments = uses.get(n) or (['РЕДКИЙ БОНУС'] if '/' in n else [])
        rows.append({
            'id': os.path.basename(n).replace('.mp3', ''),
            'file': 'sounds/' + n, 'group': title, 'label': os.path.basename(n).replace('.mp3', ''),
            'moments': moments,
            'do': round(r['before']['rms_peak_db'], 1), 'posle': round(r['after']['rms_peak_db'], 1), 'gain': round(r['gain_db'], 1),
            'sec': r['before']['seconds'],
        })
vals_do = [x['do'] for x in rows]; vals_po = [x['posle'] for x in rows]
summary = {'n': len(rows), 'razbros_do': round(max(vals_do) - min(vals_do), 1), 'razbros_posle': round(max(vals_po) - min(vals_po), 1),
           'target': zamer['target_db'], 'cap': zamer['cap_db']}
data = json.dumps({'rows': rows, 'summary': summary}, ensure_ascii=False)
html = open(os.path.join(HERE, 'shablon.html'), encoding='utf-8').read()
assert html.count('__DANNYE__') == 1
open(os.path.join(HERE, 'index.html'), 'w', encoding='utf-8').write(html.replace('__DANNYE__', data))
print(f"{len(rows)} звуков; разброс {summary['razbros_do']} → {summary['razbros_posle']} дБ; записано {os.path.join(HERE, 'index.html')}")
print(json.dumps({r['id']: r['moments'] for r in rows if '/' not in r['file'].replace('sounds/', '')}, ensure_ascii=False))
