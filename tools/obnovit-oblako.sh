#!/bin/sh
# Положить общий модуль oblako в app/_vendor/oblako@<тег>/ (правило 38а).
# Руками vendor не правят: кладёт только этот скрипт, test/oblako-vendor.test.mjs сверяет sha
# с MANIFEST.json тега. Папка с «_» — приватная для маршрутов Next/vinext, страницей не станет.
#   sh tools/obnovit-oblako.sh v1.0.0
set -eu
TEG="${1:?тег модуля, например v1.0.0}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
MODUL="${MODUL:-$HOME/dev/_games/_obshchee/oblako}"
git -C "$MODUL" rev-parse -q --verify "refs/tags/$TEG" >/dev/null || { echo "в $MODUL нет тега $TEG" >&2; exit 1; }
KUDA="$HERE/app/_vendor/oblako@$TEG"
rm -rf "$KUDA"; mkdir -p "$KUDA"
git -C "$MODUL" archive "$TEG" src MANIFEST.json | tar -x -C "$KUDA"
( cd "$KUDA" && node -e "
const m=require('./MANIFEST.json');const c=require('crypto');const fs=require('fs');let bad=0;
for(const[f,w]of Object.entries(m.files)){const h=c.createHash('sha256').update(fs.readFileSync(f)).digest('hex');if(h!==w){console.error('не сошлось',f);bad++}}
if(m.version!=='$TEG'.slice(1)){console.error('версия манифеста',m.version);bad++}
process.exit(bad?1:0)" )
echo "ok: $KUDA ($(git -C "$MODUL" rev-parse --short "$TEG^{commit}"))"
