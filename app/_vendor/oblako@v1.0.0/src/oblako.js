// oblako — клиент общего облака игр (PocketBase на aka-gst.ru/oblako, репо aka-gst/igry-oblako).
// Правило 30б: настройка владельца становится заводской для всех; игра читает заводские
// при загрузке и откатывается на встроенные, если облака нет. Один сервис на все игры.
//
// Поведение при сбоях (п.7р): игроку — ничего, игра идёт на встроенном; нам — console.warn
// с причиной. Наружу ничего о человеке (п.30): игрок — анонимный id из localStorage,
// имя в рекордах — только введённое самим игроком.

const NASTROYKI = {
  adres: '/oblako',          // база API: тот же origin, что у игры (aka-gst.ru)
  taimautMs: 1500,           // заводские при загрузке: дольше ждать нельзя, игра стартует
  taimautZapisiMs: 6000,     // сохранения, рекорды, запись владельца
  hranilische: undefined,    // localStorage по умолчанию; в тестах — своё
  fetch: undefined,          // globalThis.fetch по умолчанию
};
const IGRA_RE = /^(test:)?[a-z0-9-]{1,40}$/;
const KLYUCH_RE = /^[a-z0-9_.-]{1,60}$/;
const ID_RE = /^[a-f0-9]{32}$/;
const K_IGROK = 'oblako:igrok';
const K_VLADELETS = 'oblako:vladelets';
const MAX_SOHRANENIE = 250000;  // байт JSON; на сервере предел 256000

export function nastroit(chto = {}) {
  for (const k of Object.keys(chto)) {
    if (!(k in NASTROYKI)) { gromko(`nastroit: неизвестный ключ «${k}»`); continue; }
    NASTROYKI[k] = chto[k];
  }
}

function gromko(...chto) {
  try { console.warn('[oblako]', ...chto); } catch { /* консоли может не быть */ }
}

const pamyat = new Map();
const vPamyati = {
  getItem: (k) => (pamyat.has(k) ? pamyat.get(k) : null),
  setItem: (k, v) => { pamyat.set(k, String(v)); },
  removeItem: (k) => { pamyat.delete(k); },
};
function hran() {
  if (NASTROYKI.hranilische) return NASTROYKI.hranilische;
  try { if (globalThis.localStorage) return globalThis.localStorage; } catch { /* закрыто */ }
  return vPamyati;
}
function prochitat(k) { try { return hran().getItem(k); } catch { return null; } }
function zapisat(k, v) {
  try { hran().setItem(k, v); return true; } catch { gromko('хранилище браузера закрыто: держу в памяти до закрытия вкладки'); vPamyati.setItem(k, v); return false; }
}
function steret(k) { try { hran().removeItem(k); } catch { /* нечего */ } vPamyati.removeItem(k); }

function sluchaynyyId() {
  const b = new Uint8Array(16);
  globalThis.crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

/** Анонимный id игрока: 32 hex, живёт в localStorage этой игры-сайта. Ничего о человеке. */
export function igrokId() {
  let id = prochitat(K_IGROK) || vPamyati.getItem(K_IGROK);
  if (!id || !ID_RE.test(id)) {
    id = sluchaynyyId();
    zapisat(K_IGROK, id);
  }
  return id;
}

async function zapros(put, { method = 'GET', body, headers = {}, taimautMs = NASTROYKI.taimautZapisiMs } = {}) {
  const f = NASTROYKI.fetch || globalThis.fetch;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), taimautMs);
  try {
    const res = await f(String(NASTROYKI.adres).replace(/\/$/, '') + put, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...headers },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
      credentials: 'omit',
      cache: 'no-store',
    });
    const text = await res.text();
    let json = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* не JSON — разберёт вызывающий */ }
    return { status: res.status, json };
  } catch (err) {
    return { status: 0, json: null, oshibka: ctl.signal.aborted ? `нет ответа за ${taimautMs} мс` : String(err && err.message || err) };
  } finally {
    clearTimeout(t);
  }
}
// Легло = сервер вернул саму запись. 200 с чужим телом (прокси, заглушка, страница ошибки) — не легло.
const legla = (r) => r.status === 200 && typeof r.json?.id === 'string';
const filtr = (s) => '?filter=' + encodeURIComponent(s);
const Z = '/api/collections/zavodskie_nastroyki/records';
const S = '/api/collections/sohraneniya/records';
const R = '/api/collections/rekordy/records';

function kopiya(x) {
  try { return structuredClone(x); } catch { return JSON.parse(JSON.stringify(x ?? {})); }
}

/**
 * Заводские настройки игры: облако поверх встроенных, по ключам.
 * Никогда не бросает и не ждёт дольше taimautMs: облака нет — вернёт копию встроенных.
 * С { podrobno: true } вернёт { nastroyki, istochnik: 'oblako' | 'vstroennye', obnovleno, prichina }.
 */
export async function getZavodskie(igra, vstroennye = {}, { podrobno = false } = {}) {
  const itog = (nastroyki, istochnik, obnovleno = '', prichina = '') =>
    (podrobno ? { nastroyki, istochnik, obnovleno, prichina } : nastroyki);
  const baza = kopiya(vstroennye || {});
  if (!IGRA_RE.test(String(igra))) {
    gromko(`getZavodskie: имя игры «${igra}» не подходит под ${IGRA_RE} — играю на встроенных`);
    return itog(baza, 'vstroennye', '', 'имя игры');
  }
  const r = await zapros(Z + filtr(`igra='${igra}'`) + '&perPage=200&fields=klyuch,znachenie,obnovleno',
    { taimautMs: NASTROYKI.taimautMs });
  if (r.status !== 200 || !Array.isArray(r.json?.items)) {
    const prichina = r.oshibka || `ответ ${r.status}`;
    gromko(`getZavodskie(${igra}): облако недоступно (${prichina}) — играю на встроенных`);
    return itog(baza, 'vstroennye', '', prichina);
  }
  let obnovleno = '';
  for (const x of r.json.items) {
    if (!KLYUCH_RE.test(String(x.klyuch))) continue;
    baza[x.klyuch] = x.znachenie;
    if (String(x.obnovleno) > obnovleno) obnovleno = String(x.obnovleno);
  }
  return itog(baza, r.json.items.length ? 'oblako' : 'vstroennye', obnovleno);
}

async function naytiSvoyoSohranenie(igra, id) {
  const r = await zapros(S + filtr(`igra='${igra}'`) + '&perPage=1', { headers: { 'X-Igrok': id } });
  if (r.status !== 200 || !Array.isArray(r.json?.items)) return { oshibka: r.oshibka || `ответ ${r.status}` };
  const z = r.json.items[0];
  return { zapis: z && typeof z.id === 'string' ? z : null };
}

/** Облачное сохранение партии. true — легло, false — нет (причина в console.warn). */
export async function saveOblako(igra, dannye, versiya = 0) {
  if (!IGRA_RE.test(String(igra))) { gromko(`saveOblako: имя игры «${igra}» не подходит`); return false; }
  let razmer = 0;
  try { razmer = new TextEncoder().encode(JSON.stringify(dannye)).length; } catch (err) {
    gromko('saveOblako: данные не превращаются в JSON —', String(err)); return false;
  }
  if (razmer > MAX_SOHRANENIE) { gromko(`saveOblako(${igra}): ${razmer} байт больше предела ${MAX_SOHRANENIE}`); return false; }
  const id = igrokId();
  const n = await naytiSvoyoSohranenie(igra, id);
  if (n.oshibka) { gromko(`saveOblako(${igra}): облако недоступно (${n.oshibka})`); return false; }
  const telo = { dannye, versiya: Math.max(0, Math.floor(Number(versiya) || 0)) };
  const r = n.zapis
    ? await zapros(`${S}/${n.zapis.id}`, { method: 'PATCH', body: telo, headers: { 'X-Igrok': id } })
    : await zapros(S, { method: 'POST', body: { igra, ...telo }, headers: { 'X-Igrok': id } });
  if (!legla(r)) { gromko(`saveOblako(${igra}): не легло (${r.oshibka || 'ответ ' + r.status})`); return false; }
  return true;
}

/** Облачное сохранение этого игрока: { dannye, versiya, obnovleno } или null. */
export async function loadOblako(igra) {
  if (!IGRA_RE.test(String(igra))) { gromko(`loadOblako: имя игры «${igra}» не подходит`); return null; }
  const n = await naytiSvoyoSohranenie(igra, igrokId());
  if (n.oshibka) { gromko(`loadOblako(${igra}): облако недоступно (${n.oshibka})`); return null; }
  if (!n.zapis) return null;
  return { dannye: n.zapis.dannye, versiya: n.zapis.versiya ?? 0, obnovleno: n.zapis.obnovleno ?? '' };
}

/** Рекорд. Имя — только если игрок ввёл сам; сервер режет до 16 знаков и фильтрует. */
export async function rekord(igra, { ochki, rezhim = '', imya = '' } = {}) {
  if (!IGRA_RE.test(String(igra))) { gromko(`rekord: имя игры «${igra}» не подходит`); return false; }
  const o = Number(ochki);
  if (!Number.isInteger(o) || o < 0 || o > 1e9) { gromko(`rekord(${igra}): очки должны быть целым 0…1e9, пришло ${ochki}`); return false; }
  if (!/^[a-z0-9-]{0,24}$/.test(String(rezhim))) { gromko(`rekord(${igra}): режим «${rezhim}» не подходит`); return false; }
  const r = await zapros(R, {
    method: 'POST',
    body: { igra, ochki: o, rezhim: String(rezhim), imya_pokaza: Array.from(String(imya || '')).slice(0, 16).join('') },
    headers: { 'X-Igrok': igrokId() },
  });
  if (!legla(r)) { gromko(`rekord(${igra}): не лёг (${r.oshibka || 'ответ ' + r.status})`); return false; }
  return true;
}

/** Таблица рекордов: [{ imya, ochki, rezhim, kogda }], при сбое — []. */
export async function rekordy(igra, { rezhim, skolko = 10 } = {}) {
  if (!IGRA_RE.test(String(igra))) { gromko(`rekordy: имя игры «${igra}» не подходит`); return []; }
  let f = `igra='${igra}'`;
  if (rezhim !== undefined) {
    if (!/^[a-z0-9-]{0,24}$/.test(String(rezhim))) { gromko(`rekordy: режим «${rezhim}» не подходит`); return []; }
    f += ` && rezhim='${rezhim}'`;
  }
  const n = Math.min(100, Math.max(1, Math.floor(Number(skolko) || 10)));
  const r = await zapros(R + filtr(f) + `&sort=-ochki,sozdano&perPage=${n}&fields=imya_pokaza,ochki,rezhim,sozdano`);
  if (r.status !== 200 || !Array.isArray(r.json?.items)) { gromko(`rekordy(${igra}): облако недоступно (${r.oshibka || 'ответ ' + r.status})`); return []; }
  return r.json.items.map((x) => ({ imya: x.imya_pokaza || '', ochki: x.ochki, rezhim: x.rezhim || '', kogda: x.sozdano || '' }));
}

// ── Владелец ────────────────────────────────────────────────────────────────
// Ключ владельца живёт на сервере (хеш) и в его браузере (токен после входа),
// в коде страниц его нет. Сам ключ никуда не сохраняется и не печатается.

function tokenVladeltsa() {
  const t = prochitat(K_VLADELETS) || vPamyati.getItem(K_VLADELETS);
  if (!t) return '';
  try {
    const exp = JSON.parse(atob(t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).exp;
    if (exp && exp * 1000 < Date.now()) { steret(K_VLADELETS); return ''; }
  } catch { steret(K_VLADELETS); return ''; }
  return t;
}

export function vladeletsVoshel() { return Boolean(tokenVladeltsa()); }
export function vyitiVladeltsu() { steret(K_VLADELETS); }

/** Вход владельца ключом. { ok, prichina } — причина словами для панели. */
export async function voitiVladeltsem(klyuch) {
  const k = String(klyuch || '').trim();
  if (k.length < 16) return { ok: false, prichina: 'ключ короче 16 знаков' };
  const r = await zapros('/api/collections/vladelets/auth-with-password', {
    method: 'POST', body: { identity: 'vladelets', password: k },
  });
  if (r.status === 200 && typeof r.json?.token === 'string') { zapisat(K_VLADELETS, r.json.token); return { ok: true, prichina: '' }; }
  if (r.status === 400) return { ok: false, prichina: 'ключ не подошёл' };
  if (r.status === 429) return { ok: false, prichina: 'слишком много попыток — подождите минуту' };
  gromko(`voitiVladeltsem: облако недоступно (${r.oshibka || 'ответ ' + r.status})`);
  return { ok: false, prichina: 'облако недоступно' };
}

/** Продлить вход (месяц от сейчас). Панель зовёт при открытии. */
export async function prodlitVhod() {
  const t = tokenVladeltsa();
  if (!t) return false;
  const r = await zapros('/api/collections/vladelets/auth-refresh', { method: 'POST', headers: { Authorization: t } });
  if (r.status === 200 && typeof r.json?.token === 'string') { zapisat(K_VLADELETS, r.json.token); return true; }
  if (r.status === 401 || r.status === 403 || r.status === 404) steret(K_VLADELETS);
  return false;
}

/** Сделать значение заводским для всех. Только владелец. { ok, prichina }. */
export async function sdelatZavodskim(igra, klyuch, znachenie) {
  if (!IGRA_RE.test(String(igra))) { gromko(`sdelatZavodskim: имя игры «${igra}» не подходит`); return { ok: false, prichina: 'имя игры' }; }
  if (!KLYUCH_RE.test(String(klyuch))) { gromko(`sdelatZavodskim: ключ «${klyuch}» не подходит`); return { ok: false, prichina: 'имя настройки' }; }
  const t = tokenVladeltsa();
  if (!t) return { ok: false, prichina: 'нужен вход ключом владельца' };
  const est = await zapros(Z + filtr(`igra='${igra}' && klyuch='${klyuch}'`) + '&perPage=1&fields=id');
  if (est.status !== 200 || !Array.isArray(est.json?.items)) { gromko(`sdelatZavodskim: облако недоступно (${est.oshibka || 'ответ ' + est.status})`); return { ok: false, prichina: 'облако недоступно' }; }
  const id = est.json?.items?.[0]?.id;
  const r = id
    ? await zapros(`${Z}/${id}`, { method: 'PATCH', body: { znachenie }, headers: { Authorization: t } })
    : await zapros(Z, { method: 'POST', body: { igra, klyuch, znachenie }, headers: { Authorization: t } });
  if (legla(r)) return { ok: true, prichina: '' };
  if (r.status === 401 || r.status === 403) { steret(K_VLADELETS); return { ok: false, prichina: 'ключ больше не действует — войдите заново' }; }
  gromko(`sdelatZavodskim(${igra}, ${klyuch}): не легло (${r.oshibka || 'ответ ' + r.status})`);
  return { ok: false, prichina: r.status === 400 ? 'облако не приняло данные (слишком большие?)' : 'облако недоступно' };
}
