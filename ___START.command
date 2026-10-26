#!/bin/bash
# ТЕТКОЛОР — один запуск: игра из рабочей папки (исходники app/, то, что сейчас выписано),
# через dev-сервер проекта (pnpm dev = vinext dev, порт 3000, адрес http://localhost:3000/).
# Порт постоянный — на нём живут сохранения. Повторный запуск гасит прежний сервер ЭТОЙ папки;
# чужую программу на 3000 не трогает (тогда берёт следующий свободный порт и предупреждает).
# Сервер сам вкладок не открывает. Закрыл окно Терминала — сервер погас.
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT" || exit 1
command -v node >/dev/null 2>&1 || { echo 'Нужен Node.js'; read -r -p 'Enter — закрыть' _; exit 1; }
[ -x node_modules/.bin/vinext ] || { echo 'Нет node_modules — нужен pnpm install в этой папке'; read -r -p 'Enter — закрыть' _; exit 1; }
PORT=3000
for p in $(/usr/sbin/lsof -t -nP -iTCP:$PORT -sTCP:LISTEN 2>/dev/null); do
  cwd=$(/usr/sbin/lsof -a -p "$p" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p')
  if [ "$cwd" = "$ROOT" ]; then echo "гашу прежний сервер Тетколора ($p)"; kill "$p"; fi
done
for i in $(seq 1 50); do /usr/sbin/lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.1; done
if /usr/sbin/lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; then
  echo "Порт 3000 занят чужой программой — беру другой. Сохранения с порта 3000 на нём не видны."
  while /usr/sbin/lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
fi
echo "ТЕТКОЛОР: запускаю сервер, первый старт занимает несколько секунд…"
./node_modules/.bin/vinext dev --port $PORT >/dev/null 2>&1 &
PID=$!
trap 'kill "$PID" 2>/dev/null' EXIT INT TERM HUP
U="http://localhost:$PORT/"
for i in $(seq 1 600); do curl -s -o /dev/null --max-time 2 "$U" && break; kill -0 "$PID" 2>/dev/null || { echo 'Сервер не запустился'; read -r -p 'Enter — закрыть' _; exit 1; }; sleep 0.1; done
open -a "Google Chrome" "$U" 2>/dev/null || open "$U"
echo "Открыто: $U — чтобы выключить игру, закрой это окно или нажми Ctrl+C."
wait "$PID"
