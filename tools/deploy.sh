#!/bin/sh
# Выкладка Тетколора на aka-gst.ru/tetcolor/.
#
#   sh tools/deploy.sh            проверка: тесты, чистое ли дерево, что уедет
#   sh tools/deploy.sh --deploy   выложить, собрать, перезапустить и сверить бой
#
# Игра не статика. На bonita живёт контейнер tetcolor (node, `vinext start`),
# в него примонтирован /opt/zakriva/apps/tetcolor как /app. Выкладка — это
# исходники app/ и public/ туда, сборка ВНУТРИ контейнера и перезапуск.
# Так её делала сессия Тетколора с августа (scp + docker exec pnpm build);
# здесь та же процедура, но со сверкой: «rsync прошёл» не значит «на бою».
set -eu

DEPLOY=no
[ "${1:-}" = "--deploy" ] && DEPLOY=yes
SSH_HOST="${SSH_HOST:-bonita}"
APP_DIR="${APP_DIR:-/opt/zakriva/apps/tetcolor}"
CONTAINER="${CONTAINER:-tetcolor}"
URL="https://aka-gst.ru/tetcolor/"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
cd "$HERE"

# Белый список: уезжают только эти каталоги. Всё прочее в корне (ФИНИШ.md,
# заметки, tools/) на сервер не попадает вовсе.
SHIP="app public"

echo "тесты"
node --test test/*.test.mjs >/dev/null 2>&1 || { echo "ОШИБКА: тесты не проходят, выкладка отменена" >&2; exit 1; }

# Уезжает диск, а сверяется коммит: незакоммиченное в app/ или public/ — стоп.
DIRTY=$(git status --porcelain -- $SHIP)
[ -z "$DIRTY" ] || { echo "ОШИБКА: в $SHIP есть незакоммиченное:" >&2; echo "$DIRTY" >&2; exit 1; }
COMMIT=$(git rev-parse --short HEAD)

echo "что отличается от сервера (коммит $COMMIT):"
for d in $SHIP; do
  rsync -rnci --delete --exclude .DS_Store -e "ssh -o BatchMode=yes -o ConnectTimeout=20" "$d/" "$SSH_HOST:$APP_DIR/$d/" | sed 's/^/  /'
done

[ "$DEPLOY" = yes ] || { echo; echo "это была проверка. для выкладки: sh tools/deploy.sh --deploy"; exit 0; }

echo
echo "выкладка исходников"
for d in $SHIP; do
  n=1
  until rsync -rc --delete --exclude .DS_Store -e "ssh -o BatchMode=yes -o ConnectTimeout=20" "$d/" "$SSH_HOST:$APP_DIR/$d/"; do
    [ "$n" -ge 3 ] && { echo "ОШИБКА: $d не доехал" >&2; exit 1; }
    n=$((n + 1)); sleep 5
  done
done

echo "сверка исходников на сервере"
LOCAL_SUM="$(mktemp)"; REMOTE_SUM="$(mktemp)"
trap 'rm -f "$LOCAL_SUM" "$REMOTE_SUM"' EXIT
find $SHIP -type f ! -name .DS_Store -exec shasum -a 256 {} + | awk '{print $2, $1}' | sort > "$LOCAL_SUM"
ssh -o ConnectTimeout=20 "$SSH_HOST" "cd '$APP_DIR' && find $SHIP -type f ! -name .DS_Store -exec sha256sum {} +" | awk '{print $2, $1}' | sort > "$REMOTE_SUM"
if ! cmp -s "$LOCAL_SUM" "$REMOTE_SUM"; then
  echo "ОШИБКА: исходники на сервере не совпали с деревом:" >&2
  diff "$LOCAL_SUM" "$REMOTE_SUM" | head -20 >&2
  exit 1
fi
echo "  совпало $(wc -l < "$LOCAL_SUM" | tr -d ' ') файлов"

echo "сборка в контейнере и перезапуск"
ssh -o ConnectTimeout=20 "$SSH_HOST" "docker exec -w /app '$CONTAINER' sh -c 'pnpm build >/tmp/tetcolor-build.log 2>&1' || { docker exec '$CONTAINER' tail -30 /tmp/tetcolor-build.log; exit 1; }; docker restart '$CONTAINER' >/dev/null" \
  || { echo "ОШИБКА: сборка или перезапуск не прошли" >&2; exit 1; }

# После перезапуска контейнер ставит pnpm и зависимости — это десятки секунд.
echo "жду, пока бой поднимется"
i=0
until [ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$URL?x=$i")" = 200 ]; do
  i=$((i + 1)); [ "$i" -ge 60 ] && { echo "ОШИБКА: $URL не ответил 200 за 3 минуты" >&2; exit 1; }
  sleep 3
done

echo "сверка боя"
FAIL=0
HTML="$(curl -s --retry 4 --retry-all-errors --max-time 20 "$URL?x=$(date +%s)")"
CSS=$(printf '%s' "$HTML" | grep -o '/_next/static/css/[^"]*\.css' | head -1)
[ -n "$CSS" ] || { echo "  в странице нет таблицы стилей /_next/static/css/…"; FAIL=1; }
if [ -n "$CSS" ]; then
  # Страницу отдаёт новый процесс, только если её таблица лежит в свежей сборке и совпадает байт в байт.
  want=$(ssh -o ConnectTimeout=20 "$SSH_HOST" "sha256sum '$APP_DIR/dist/client$CSS' 2>/dev/null" | cut -d' ' -f1)
  got=$(curl -s --retry 4 --retry-all-errors --max-time 20 "https://aka-gst.ru$CSS" | shasum -a 256 | cut -d' ' -f1)
  if [ -n "$want" ] && [ "$want" = "$got" ]; then echo "  $CSS  совпало со сборкой"; else echo "  $CSS  НЕ ИЗ СВЕЖЕЙ СБОРКИ"; FAIL=1; fi
fi
want=$(shasum -a 256 public/sw.js | cut -d' ' -f1)
got=$(curl -s --retry 4 --retry-all-errors --max-time 20 "${URL}sw.js?x=$(date +%s)" | shasum -a 256 | cut -d' ' -f1)
if [ "$want" = "$got" ]; then echo "  sw.js  совпало"; else echo "  sw.js  НЕ ТО СОДЕРЖИМОЕ"; FAIL=1; fi
for p in ФИНИШ.md package.json app/page.tsx tools/deploy.sh .git/config; do
  code=$(curl -s --retry 3 --max-time 15 -o /dev/null -w '%{http_code}' "$URL$p")
  [ "$code" = 404 ] || { printf '  %-18s %s  ДОЛЖНО БЫТЬ 404\n' "$p" "$code"; FAIL=1; }
done
[ "$FAIL" = 0 ] || { echo "ОШИБКА: бой не совпал с тем, что уехало" >&2; exit 1; }
echo
echo "готово: $URL — коммит $COMMIT"
