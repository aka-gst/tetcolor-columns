import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

// Правило 38а: общий модуль oblako лежит в app/_vendor/oblako@<тег>/ и кладётся только
// tools/obnovit-oblako.sh. Правка руками краснеет здесь: sha не сходится с MANIFEST.json тега.
const page = readFileSync(new URL('../app/page.tsx', import.meta.url), 'utf8');
const vendor = new URL('../app/_vendor/', import.meta.url);

test('vendor oblako совпадает с манифестом своего тега байт в байт', () => {
  const papki = readdirSync(vendor).filter(name => name.startsWith('oblako@'));
  assert.equal(papki.length, 1, 'ровно одна версия модуля в vendor: ' + papki.join(', '));
  const papka = new URL(papki[0] + '/', vendor);
  const manifest = JSON.parse(readFileSync(new URL('MANIFEST.json', papka), 'utf8'));
  assert.equal('oblako@v' + manifest.version, papki[0]);
  for (const [file, want] of Object.entries(manifest.files)) {
    const got = createHash('sha256').update(readFileSync(new URL(file, papka))).digest('hex');
    assert.equal(got, want, file + ' правили руками — обновлять только tools/obnovit-oblako.sh');
  }
  assert.ok(page.includes(`from './_vendor/${papki[0]}/src/index.js'`), 'страница подключает именно эту версию');
  // отрицательный контроль сверки: чужая сумма не совпадает
  const [first] = Object.keys(manifest.files);
  assert.notEqual(createHash('sha256').update(readFileSync(new URL(first, papka))).digest('hex'), '0'.repeat(64));
});

test('заводские из облака: игра просит tetcolor, своё в браузере главнее, ключа в коде нет', () => {
  assert.match(page, /getZavodskie\('tetcolor', \{\}\)/);
  assert.match(page, /if \(!hasLocal\(CONFIG_KEY\)\)/);
  assert.match(page, /sdelatZavodskim\('tetcolor', 'zvuki'/);
  assert.match(page, /СДЕЛАТЬ ЗАВОДСКИМ ДЛЯ ВСЕХ/);
  assert.match(page, /type="password"/);
  // Ключ не зашит в страницу (правило 30б): ни «админ19»-подобных строк, ни длинных секретов.
  assert.doesNotMatch(page, /админ\d+|admin\d{2,}/i);
  assert.doesNotMatch(page, /voitiVladeltsem\(['"`]/, 'ключ передаётся только из поля ввода');
});

// Сервис-воркер игры ловит все GET своего origin и отдаёт из кэша, срезав запрос
// (?filter=…). Облако через него ходить не должно: иначе заводские приходят на заход
// позже, а поиск записи перед «сделать заводским» получает чужой ответ без id.
test('сервис-воркер не трогает запросы к облаку, а свои файлы по-прежнему берёт на себя', () => {
  const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
  const handlers = {};
  const self = { location: new URL('https://aka-gst.ru/tetcolor/sw.js'), addEventListener: (type, fn) => { handlers[type] = fn; } };
  const caches = { match: async () => undefined, open: async () => ({ put: async () => {} }) };
  new Function('self', 'caches', 'fetch', src)(self, caches, async () => new Response('x'));
  const handled = (href) => {
    let taken = false;
    handlers.fetch({ request: { method: 'GET', url: href, mode: 'cors' }, respondWith: () => { taken = true; } });
    return taken;
  };
  assert.equal(handled("https://aka-gst.ru/oblako/api/collections/zavodskie_nastroyki/records?filter=igra%3D'tetcolor'"), false);
  assert.equal(handled('https://aka-gst.ru/api/leaderboard'), false);
  // отрицательный контроль: свой файл игры воркер берёт — значит, проверка видит перехват
  assert.equal(handled('https://aka-gst.ru/tetcolor/favicon.svg?v=1'), true);
});
