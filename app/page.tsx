'use client';

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number>) => void };
    requestPlayerName: () => Promise<string>;
    /* Shared with the other games, served from the site root. Optional: the
       page has to work when it has not loaded. */
    Tour?: {
      start: (steps: TourStep[], opts?: { onEnd?: () => void }) => unknown;
      once: (key: string, steps: TourStep[], opts?: { onEnd?: () => void }) => unknown;
      seen: (key: string) => boolean;
    };
    webkitAudioContext?: typeof AudioContext;
  }
}

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';

const WIDTH = 7;
const HEIGHT = 16;
const createAudioContext = () => {
  const AudioEngine = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioEngine) throw new Error('Web Audio is unavailable');
  return new AudioEngine();
};
/* What a finished turn hands back: the settled board, the points it earned
   and how many cascades deep it went. */
type TurnResult = { board: Board; points: number; cascade: number };
type TourStep = { sel: string; text: string; onlyIfVisible?: boolean };
/* Shown over the real board once per device, and again from «КАК ИГРАТЬ».
   Gravity is held while it runs — reading a card is not a reason to lose a
   column. The touch bar is not on screen on a desktop; the tour says its line
   anyway, without a highlight, which is why the text names both. The next
   column preview is a different case: a phone does not show it at all, so
   promising it would be a lie and the step is dropped instead. */
const TOUR_STEPS: TourStep[] = [
  { sel: '.well', text: 'Колонка из трёх кубиков падает сюда. Тапни по стакану — цвета в колонке сдвинутся по кругу.' },
  { sel: '.preview', text: 'Следующая колонка. Видно заранее, что придёт.', onlyIfVisible: true },
  { sel: '.touch', text: 'Тащи в сторону — колонка едет по клеткам, вниз — падает быстрее. На компьютере: стрелки и пробел.' },
  { sel: '.stats', text: 'Три одинаковых цвета в ряд — по вертикали, горизонтали или диагонали — сгорают. Чем выше уровень, тем быстрее падает.' },
];

const visibleSteps = () => TOUR_STEPS.filter(step => {
  if (!step.onlyIfVisible) return true;
  const target = document.querySelector<HTMLElement>(step.sel);
  return !!target && target.offsetParent !== null;
});

const PALETTE = ['#ff2bd6', '#efff00', '#00ff85', '#00d9ff', '#9b5cff'];
/* Six drawings for the same moment. One burst repeated on every clear reads as
   a stamp; drawing from six — three scatters, a shock ring, a ripple and a
   star — reads as an explosion. Relative paths keep them resolving under both
   / and /tetcolor/. */
const BURSTS = ['burst.png', 'burst-ring.png', 'burst-rings.png', 'burst-g.webp', 'burst-h.webp', 'burst-i.webp'];
const pickBurst = () => {
  const file = BURSTS[Math.floor(Math.random() * BURSTS.length)];
  document.documentElement.style.setProperty('--burst', `url(${new URL(file, document.baseURI).href})`);
};
const BLOCK_STYLES = [
  ['classic', 'КЛАССИКА'],
  ['pixel', 'ПИКСЕЛЬ'],
  ['glass', 'СТЕКЛО'],
  ['outline', 'КОНТУР'],
  ['faceted', 'ОГРАНКА'],
  ['neon', 'НЕОН'],
  ['crt', 'ЭЛТ'],
  ['chrome', 'ХРОМ'],
  ['candy', 'ЛЕДЕНЕЦ'],
  ['circuit', 'СХЕМА'],
  ['inlay', 'ОПРАВА'],
] as const;
type BlockStyle = typeof BLOCK_STYLES[number][0];
/* Either a look pinned from the panel, or the roll that hands out a different
   one every game. */
type BlockChoice = BlockStyle | 'random';
const BLOCK_KEY = 'tetcolor-blocks';

/* По кубику на каждый из одиннадцати видов — стартовый экран заодно
   показывает всё, чем можно играть. Летят из-за нижнего края за верхний, а не
   возникают посреди экрана; вертикаль ведёт обёртка, а качание и вращение —
   сам кубик, поэтому у каждого своя дорога и они не идут строем. Приглушены
   до уровня фона: это подкладка, а не участники. */
const DRIFT = BLOCK_STYLES.map(([look], index) => ({
  look,
  left: `${3 + index * 8.9}%`,
  size: [30, 20, 26, 17, 34, 22, 28, 19, 24, 32, 21][index],
  time: [34, 46, 29, 52, 38, 43, 31, 49, 36, 27, 41][index],
  delay: -[0, 9, 21, 4, 33, 14, 26, 7, 18, 39, 11][index],
  sway: [16, 9, 22, 12, 7, 19, 14, 24, 10, 17, 13][index],
  swayTime: [11, 7, 14, 9, 16, 8, 12, 6, 15, 10, 13][index],
  spin: `${[80, -120, 150, -70, 110, -160, 95, -130, 65, -105, 140][index]}deg`,
  colour: index % PALETTE.length,
}));

/* Что выпало в прошлый раз — чтобы бросок не повторился при перезагрузке.
   Один шанс из одиннадцати повторить кажется человеку не случайностью, а
   поломкой, и одиннадцать видов существуют затем, чтобы их видели. */
const LAST_KEY = 'tetcolor-last-blocks';
const isBlockStyle = (value: string): value is BlockStyle => BLOCK_STYLES.some(([id]) => id === value);
/* Never the look that just played: two games in a row of the same one is
   exactly what makes a shuffle feel broken. */
const rollBlocks = (avoid?: BlockStyle): BlockStyle => {
  const pool = BLOCK_STYLES.filter(([id]) => id !== avoid);
  return pool[Math.floor(Math.random() * pool.length)][0];
};

const DEMO_W = 5;
const DEMO_H = 9;
type Demo = { board: Board; x: number; y: number; colors: number[]; clearing: string[] };

const demoSpawn = () => ({
  x: Math.floor(Math.random() * DEMO_W),
  y: -3,
  colors: Array.from({ length: 3 }, () => Math.floor(Math.random() * PALETTE.length)),
});
const freshDemo = (): Demo => ({
  board: Array.from({ length: DEMO_H }, () => Array<Cell>(DEMO_W).fill(null)),
  ...demoSpawn(),
  clearing: [],
});

const demoMatches = (board: Board) => {
  const hit = new Set<string>();
  for (let y = 0; y < DEMO_H; y += 1) for (let x = 0; x < DEMO_W; x += 1) {
    const colour = board[y][x];
    if (colour === null) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      if (board[y - dy]?.[x - dx] === colour) continue;
      const run: string[] = [];
      for (let cx = x, cy = y; board[cy]?.[cx] === colour; cx += dx, cy += dy) run.push(`${cx}:${cy}`);
      if (run.length >= 3) run.forEach(cell => hit.add(cell));
    }
  }
  return [...hit];
};

const demoCollapse = (board: Board): Board => {
  const next = Array.from({ length: DEMO_H }, () => Array<Cell>(DEMO_W).fill(null));
  for (let x = 0; x < DEMO_W; x += 1) {
    let write = DEMO_H - 1;
    for (let y = DEMO_H - 1; y >= 0; y -= 1) if (board[y][x] !== null) next[write--][x] = board[y][x];
  }
  return next;
};

const stepDemo = (demo: Demo): Demo => {
  if (demo.clearing.length) {
    const cleared = demo.board.map((row, y) => row.map((cell, x) => demo.clearing.includes(`${x}:${y}`) ? null : cell));
    return { board: demoCollapse(cleared), ...demoSpawn(), clearing: [] };
  }
  const fits = (x: number, y: number) => demo.colors.every((_, index) => {
    const row = y + index;
    return x >= 0 && x < DEMO_W && row < DEMO_H && (row < 0 || demo.board[row][x] === null);
  });
  if (fits(demo.x, demo.y + 1)) return { ...demo, y: demo.y + 1 };
  if (demo.y < 0) return freshDemo();
  const placed = demo.board.map(row => [...row]);
  demo.colors.forEach((colour, index) => {
    const row = demo.y + index;
    if (row >= 0) placed[row][demo.x] = colour;
  });
  const matched = demoMatches(placed);
  return matched.length
    ? { ...demo, board: placed, clearing: matched }
    : { ...demo, board: placed, ...demoSpawn() };
};
type Cell = number | null;
type Board = Cell[][];
type Piece = { x: number; y: number; colors: number[]; horizontal: boolean };
type Sound = 'start' | 'move' | 'cycle' | 'land' | 'clear' | 'level' | 'gameover';
type GlobalScore = { nickname: string; score: number };
type Flash = { id: number; text: string; tone: number };
type Quake = { tick: number; power: number };
type SoundOptions = { pitch?: number; volume?: number; delay?: number; pan?: number };

const BONUS_PHRASES = ['КИСЛОТНО!', 'ВОТ ЭТО ХОД!', 'НЕОН ГОРИТ!', 'ЖАРА!', 'ТРИ В РЯД!', '90-е ЗВОНЯТ!'];
const EASTER_FILES = Array.from({ length: 15 }, (_, index) => `sounds/eggs/egg-${index + 1}.mp3?v=4`);

const SOUND_FILES: Record<Sound, string[]> = {
  start: ['sounds/level-1.mp3?v=4', 'sounds/clear-2.mp3?v=4'],
  // Which of the two is the knock and which is the hiss was settled by ear.
  move: ['sounds/move-2.mp3?v=4'],
  cycle: ['sounds/cycle-1.mp3?v=4', 'sounds/cycle-2.mp3?v=4'],
  // One sound, every time: landing used to borrow the colour-change sounds and
  // only sounded like a landing one time in three.
  land: ['sounds/move-1.mp3?v=4'],
  clear: ['sounds/clear-1.mp3?v=4', 'sounds/clear-2.mp3?v=4', 'sounds/cycle-2.mp3?v=4'],
  level: ['sounds/level-1.mp3?v=4', 'sounds/clear-1.mp3?v=4'],
  gameover: ['sounds/gameover-1.mp3?v=4', 'sounds/gameover-2.mp3?v=4'],
};

const BASE_FILES = ['clear-1', 'clear-2', 'cycle-1', 'cycle-2', 'gameover-1', 'gameover-2', 'land-1', 'land-2', 'level-1', 'move-1', 'move-2']
  .map(name => `sounds/${name}.mp3`);
const EGG_FILES = Array.from({ length: 15 }, (_, index) => `sounds/eggs/egg-${index + 1}.mp3`);
const CUSTOM_FILES = Array.from({ length: 17 }, (_, index) => `sounds/custom/custom-${index + 1}.mp3`);
const GROUPS: { title: string; files: string[] }[] = [
  { title: 'ОБЫЧНЫЕ', files: BASE_FILES },
  { title: 'РЕДКИЕ (ПАСХАЛКИ)', files: EGG_FILES },
  { title: 'ВАШИ ЗАПИСИ', files: CUSTOM_FILES },
];
// 'egg' is the rare bonus: it has its own sound pool, so it is a moment too.
type Moment = Sound | 'egg';
const MOMENT_ORDER: Moment[] = ['start', 'move', 'cycle', 'land', 'clear', 'level', 'gameover', 'egg'];
const SOUND_LABELS: Record<Moment, string> = {
  start: 'СТАРТ ИГРЫ', move: 'ДВИЖЕНИЕ', cycle: 'СМЕНА ЦВЕТОВ', land: 'ПРИЗЕМЛЕНИЕ',
  clear: 'ЛИНИЯ СОБРАНА', level: 'НОВЫЙ УРОВЕНЬ', gameover: 'КОНЕЦ ИГРЫ', egg: 'РЕДКИЙ БОНУС',
};
const baseName = (file: string) => file.replace(/\?v=\d+$/, '');
const fileLabel = (file: string) => baseName(file).replace('sounds/', '');
/* Семнадцать собственных записей владельца лежали в библиотеке, но не были
   назначены ни на один момент: услышать их можно было, только открыв панель и
   расставив руками. Записывал он их сам — значит слышать их должны все.
   Поставлены на редкий бонус: это единственный момент, задуманный как
   неожиданность, и голосовая реплика для него — лучшее, что бывает. На частые
   события (ход, приземление) голос вешать нельзя: полсекунды речи каждые пару
   секунд сводят с ума. Расставить иначе можно в панели, двумя нажатиями. */
const defaultsFor = (moment: Moment) => moment === 'egg' ? [...EASTER_FILES, ...CUSTOM_FILES] : SOUND_FILES[moment];

type SoundSetting = { files: string[]; volume: number; pitch: number; random: boolean; reverb: boolean; crush: boolean; wide: boolean };
type Effects = { reverb: boolean; crush: boolean; wide: boolean };

// Distortion is non-linear, so how much it lifts a sound depends on that
// sound. These are measured per file — dry RMS over distorted RMS — so an
// effected hit lands at the level of the original instead of jumping out.
const CRUSH_TRIM: Record<string, number> = {
  'clear-1.mp3': 0.304,
  'clear-2.mp3': 0.236,
  'cycle-1.mp3': 0.422,
  'cycle-2.mp3': 0.297,
  'gameover-1.mp3': 0.322,
  'gameover-2.mp3': 0.428,
  'land-1.mp3': 0.385,
  'land-2.mp3': 0.281,
  'level-1.mp3': 0.224,
  'move-1.mp3': 0.589,
  'move-2.mp3': 0.457,
  'eggs/egg-1.mp3': 0.239,
  'eggs/egg-2.mp3': 0.244,
  'eggs/egg-3.mp3': 0.243,
  'eggs/egg-4.mp3': 0.232,
  'eggs/egg-5.mp3': 0.231,
  'eggs/egg-6.mp3': 0.241,
  'eggs/egg-7.mp3': 0.247,
  'eggs/egg-8.mp3': 0.208,
  'eggs/egg-9.mp3': 0.233,
  'eggs/egg-10.mp3': 0.225,
  'eggs/egg-11.mp3': 0.249,
  'eggs/egg-12.mp3': 0.231,
  'eggs/egg-13.mp3': 0.237,
  'eggs/egg-14.mp3': 0.212,
  'eggs/egg-15.mp3': 0.244,
  'custom/custom-1.mp3': 0.753,
  'custom/custom-2.mp3': 0.931,
  'custom/custom-3.mp3': 0.789,
  'custom/custom-4.mp3': 0.945,
  'custom/custom-5.mp3': 0.772,
  'custom/custom-6.mp3': 0.78,
  'custom/custom-7.mp3': 0.707,
  'custom/custom-8.mp3': 0.572,
  'custom/custom-9.mp3': 0.768,
  'custom/custom-10.mp3': 0.951,
  'custom/custom-11.mp3': 0.92,
  'custom/custom-12.mp3': 0.766,
  'custom/custom-13.mp3': 0.858,
  'custom/custom-14.mp3': 0.684,
  'custom/custom-15.mp3': 0.779,
  'custom/custom-16.mp3': 0.812,
  'custom/custom-17.mp3': 0.657,
};
// Reverb adds a wet tail beside the dry path; width only re-pans, so it is level-safe.
const REVERB_TRIM = 1.228;

// The files were recorded 32x apart in level — quietest egg against loudest
// custom clip — so no per-moment setting could even them out. Each factor is
// the measured RMS against the set's median, clamped so a very quiet file is
// not lifted until its noise floor comes with it.
/* Все сорок три уровня пересчитаны на одну опору — ту, на которой всегда
   звучали событийные звуки: под них владелец и настраивал остальное. Разброс
   на выходе упал с 8,1 дБ до 1,9, и эти оставшиеся 1,9 — не разнобой, а
   заказанное «редкие могут быть чуть громче»: они идут через базу 0.62 против
   0.5 у обычных.
   Сами файлы при этом очень разные: голосовые куски на 20 дБ громче
   событийных, а пасхалки на 5 тише. В плеере это не слышно — таблица ниже для
   того и есть, — но по самим файлам судить о громкости в игре нельзя.
Записи из «ваших» прогнаны через срез низов, расширитель вниз и полку
   сверху: они сняты в комнате и звучали глухо, с хвостом отражений. Хвост у
   большинства упал в двадцать раз, верх поднялся вдвое. Уровни пересчитаны по
   обработанным файлам, чтобы все они по-прежнему выходили одинаково громкими —
   и custom-16, который до этого был вдвое громче соседей, встал в общий ряд. */
const LEVEL_TRIM: Record<string, number> = {
  'clear-1.mp3': 1.809,
  'clear-2.mp3': 4.287,
  'cycle-1.mp3': 0.766,
  'cycle-2.mp3': 2.133,
  'gameover-1.mp3': 1.177,
  'gameover-2.mp3': 0.866,
  'land-1.mp3': 1.205,
  'land-2.mp3': 2.794,
  'level-1.mp3': 4.328,
  'move-1.mp3': 0.58,
  'move-2.mp3': 0.782,
  'eggs/egg-1.mp3': 2.579,
  'eggs/egg-2.mp3': 2.678,
  'eggs/egg-3.mp3': 2.286,
  'eggs/egg-4.mp3': 2.782,
  'eggs/egg-5.mp3': 2.564,
  'eggs/egg-6.mp3': 2.14,
  'eggs/egg-7.mp3': 1.96,
  'eggs/egg-8.mp3': 4.877,
  'eggs/egg-9.mp3': 2.444,
  'eggs/egg-10.mp3': 2.98,
  'eggs/egg-11.mp3': 1.526,
  'eggs/egg-12.mp3': 2.349,
  'eggs/egg-13.mp3': 2.312,
  'eggs/egg-14.mp3': 4.148,
  'eggs/egg-15.mp3': 1.951,
  'custom/custom-1.mp3': 0.219,
  'custom/custom-2.mp3': 0.11,
  'custom/custom-3.mp3': 0.128,
  'custom/custom-4.mp3': 0.119,
  'custom/custom-5.mp3': 0.231,
  'custom/custom-6.mp3': 0.141,
  'custom/custom-7.mp3': 0.133,
  'custom/custom-8.mp3': 0.403,
  'custom/custom-9.mp3': 0.098,
  'custom/custom-10.mp3': 0.094,
  'custom/custom-11.mp3': 0.117,
  'custom/custom-12.mp3': 0.189,
  'custom/custom-13.mp3': 0.115,
  'custom/custom-14.mp3': 0.202,
  'custom/custom-15.mp3': 0.083,
  'custom/custom-16.mp3': 0.158,
  'custom/custom-17.mp3': 0.288,
};
type SoundConfig = Partial<Record<Moment, SoundSetting>>;
const CONFIG_KEY = 'tetcolor-sound-config';
/* ── Высота без длины ───────────────────────────────────────────────────
   playbackRate у элемента <audio> сдвигает высоту вместе с длиной: разброс
   тона делал звук не только выше, но и короче. Чтобы менять только высоту,
   дорожка сначала растягивается по времени в r раз перекрытием окон, а потом
   проигрывается со скоростью r — растяжение и ускорение гасят друг друга по
   длине и складываются по высоте.

   Окна Ханна с половинным перекрытием при r = 1 дают ровно исходный сигнал;
   при r ≠ 1 сумма окон перестаёт быть постоянной, поэтому результат делится
   на неё. Фазы не выравниваются: на голосе и щелчках, из которых состоит вся
   библиотека, этого не слышно, а полный вокодер стоил бы вчетверо дороже. */
const stretchBuffer = (context: BaseAudioContext, input: AudioBuffer, ratio: number) => {
  const N = 1024, hop = N / 2;
  const step = Math.max(1, Math.round(hop * ratio));
  const length = Math.ceil(input.length * ratio) + N;
  const output = context.createBuffer(input.numberOfChannels, length, input.sampleRate);
  const window = new Float32Array(N);
  for (let i = 0; i < N; i += 1) window[i] = .5 - .5 * Math.cos(2 * Math.PI * i / N);
  for (let channel = 0; channel < input.numberOfChannels; channel += 1) {
    const from = input.getChannelData(channel);
    const into = output.getChannelData(channel);
    const sum = new Float32Array(length);
    for (let read = 0, write = 0; read + N < from.length; read += hop, write += step) {
      for (let i = 0; i < N; i += 1) { into[write + i] += from[read + i] * window[i]; sum[write + i] += window[i]; }
    }
    for (let i = 0; i < length; i += 1) if (sum[i] > 1e-4) into[i] /= sum[i];
  }
  return output;
};

/* ── Комната из записей ─────────────────────────────────────────────────
   Свои записи сняты в комнате: глухо и с хвостом отражений. Настоящее
   устранение реверберации здесь не нужно и не окупится — хватает двух
   грубых приёмов. Полка сверху возвращает разборчивость, а расширитель вниз
   давит всё тише порога: сам звук громче него и не трогается, а хвост
   комнаты — тише, и уходит. Считается один раз при загрузке. */
const deRoom = async (context: BaseAudioContext, buffer: AudioBuffer) => {
  const offline = new OfflineAudioContext(buffer.numberOfChannels, buffer.length, buffer.sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  const shelf = offline.createBiquadFilter();
  shelf.type = 'highshelf'; shelf.frequency.value = 3200; shelf.gain.value = 6;
  const cut = offline.createBiquadFilter();
  cut.type = 'highpass'; cut.frequency.value = 110;
  source.connect(cut); cut.connect(shelf); shelf.connect(offline.destination);
  source.start();
  const bright = await offline.startRendering();
  const threshold = .045, attack = .002, release = .045;
  for (let channel = 0; channel < bright.numberOfChannels; channel += 1) {
    const data = bright.getChannelData(channel);
    const up = Math.exp(-1 / (attack * bright.sampleRate));
    const down = Math.exp(-1 / (release * bright.sampleRate));
    let envelope = 0, gain = 1;
    for (let i = 0; i < data.length; i += 1) {
      const level = Math.abs(data[i]);
      envelope = level > envelope ? up * envelope + (1 - up) * level : down * envelope + (1 - down) * level;
      const wanted = envelope >= threshold ? 1 : Math.max(.06, (envelope / threshold) ** 2);
      gain = wanted < gain ? wanted : gain + (wanted - gain) * .0016;
      data[i] *= gain;
    }
  }
  return bright;
};

const TWEAK_KEY = 'tetcolor-file-tweaks';
const ADDED_KEY = 'tetcolor-added-sounds';
const HIDDEN_KEY = 'tetcolor-hidden-sounds';

// Per file rather than per moment: a badly recorded clip needs levelling and
// shaping wherever it is used, not once for each place it is used.
/* Трёхполосный эквалайзер убран: полосы стояли короткие, крутить их было
   неудобно, а нужного тембра ими всё равно не добивались. Осталась одна
   длинная громкость. */
type FileTweak = { gain: number };
const BLANK_TWEAK: FileTweak = { gain: 1 };
const ADDED_PREFIX = 'added/';
const readJson = <T,>(key: string, fallback: T): T => {
  try { return JSON.parse(window.localStorage.getItem(key) || '') as T; } catch { return fallback; }
};
// A 3% spread is what the game always had; the slider makes it adjustable.
const BLANK: SoundSetting = { files: [], volume: 1, pitch: .03, random: false, reverb: false, crush: false, wide: false };
// The rare bonus takes a random effect by default — that is its whole charm.
const blankFor = (moment: Moment): SoundSetting => ({ ...BLANK, random: moment === 'egg' });

// A saved config from the single-file version is upgraded rather than dropped.
const readConfig = (raw: string | null): SoundConfig => {
  const parsed = JSON.parse(raw || '{}') as Record<string, Partial<SoundSetting> & { file?: string }>;
  const out: SoundConfig = {};
  for (const moment of MOMENT_ORDER) {
    const value = parsed[moment];
    if (!value) continue;
    out[moment] = {
      ...blankFor(moment),
      ...value,
      files: value.files ?? (value.file ? [value.file] : []),
      volume: typeof value.volume === 'number' ? value.volume : 1,
      pitch: typeof value.pitch === 'number' ? value.pitch : .03,
    };
  }
  return out;
};

// Reverb needs an impulse; a decaying noise burst is enough and ships nothing.
const IMPULSES = new WeakMap<AudioContext, AudioBuffer>();
const reverbImpulse = (context: AudioContext) => {
  const cached = IMPULSES.get(context);
  if (cached) return cached;
  const length = Math.floor(context.sampleRate * 1.5);
  const buffer = context.createBuffer(2, length, context.sampleRate);
  for (let channel = 0; channel < 2; channel += 1) {
    const data = buffer.getChannelData(channel);
    for (let index = 0; index < length; index += 1) data[index] = (Math.random() * 2 - 1) * (1 - index / length) ** 3;
  }
  IMPULSES.set(context, buffer);
  return buffer;
};

const MASTERS = new WeakMap<AudioContext, GainNode>();
// A limiter must be inaudible until something is actually too loud. A hard
// knee just above unity leaves ordinary hits untouched — measured at 1.03x on
// a quiet sound — while 500% comes out at 0.985 peak with nothing clipped.
const masterBus = (context: AudioContext) => {
  const cached = MASTERS.get(context);
  if (cached) return cached;
  const input = context.createGain();
  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -2;
  compressor.knee.value = 0;
  compressor.ratio.value = 20;
  compressor.attack.value = .001;
  compressor.release.value = .12;
  const out = context.createGain();
  out.gain.value = .9;
  input.connect(compressor);
  compressor.connect(out);
  out.connect(context.destination);
  MASTERS.set(context, input);
  return input;
};

const CRUSH_CURVE = (() => {
  const curve = new Float32Array(1024);
  for (let index = 0; index < 1024; index += 1) {
    const x = (index * 2) / 1024 - 1;
    curve[index] = ((3 + 45) * x * 20 * Math.PI / 180) / (Math.PI + 45 * Math.abs(x));
  }
  return curve;
})();

const emptyBoard = (): Board => Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null));
// Moscow time (UTC+3, no DST) is the day boundary the leaderboard server uses
// for its "today" period, so the local daily best rolls over with the ranking.
const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;
const moscowDay = () => new Date(Date.now() + MOSCOW_OFFSET_MS).toISOString().slice(0, 10);

const newPiece = (): Piece => {
  const horizontal = Math.random() < .1;
  return { x: horizontal ? Math.floor((WIDTH - 3) / 2) : Math.floor(WIDTH / 2), y: horizontal ? -1 : -3, colors: Array.from({ length: 3 }, () => Math.floor(Math.random() * PALETTE.length)), horizontal };
};
const canPlace = (board: Board, piece: Piece, x = piece.x, y = piece.y) => piece.colors.every((_, index) => {
  const column = x + (piece.horizontal ? index : 0);
  const row = y + (piece.horizontal ? 0 : index);
  return column >= 0 && column < WIDTH && row < HEIGHT && (row < 0 || board[row][column] === null);
});

function collapse(board: Board) {
  const next = emptyBoard();
  for (let x = 0; x < WIDTH; x += 1) {
    let write = HEIGHT - 1;
    for (let y = HEIGHT - 1; y >= 0; y -= 1) if (board[y][x] !== null) next[write--][x] = board[y][x];
  }
  return next;
}

function findMatches(board: Board) {
  const matched = new Set<string>();
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
    const color = board[y][x];
    if (color === null) continue;
    for (const [dx, dy] of directions) {
      const px = x - dx; const py = y - dy;
      if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT && board[py][px] === color) continue;
      const run: string[] = [];
      for (let cx = x, cy = y; cx >= 0 && cx < WIDTH && cy >= 0 && cy < HEIGHT && board[cy][cx] === color; cx += dx, cy += dy) run.push(`${cx}:${cy}`);
      if (run.length >= 3) run.forEach((cell) => matched.add(cell));
    }
  }
  return matched;
}

export default function Home() {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [piece, setPiece] = useState<Piece>({ x: Math.floor(WIDTH / 2), y: -3, colors: [0, 1, 2], horizontal: false });
  const [score, setScore] = useState(0);
  const [pieces, setPieces] = useState(0);
  const [running, setRunning] = useState(false);
  const [started, setStarted] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState('Нажми «Старт», чтобы начать.');
  const [localBest, setLocalBest] = useState(0);
  const [clearing, setClearing] = useState<Set<string>>(() => new Set());
  const [resolving, setResolving] = useState(false);
  const [musicOn, setMusicOn] = useState(false);
  const [soundsOn, setSoundsOn] = useState(true);
  const [swapKeys, setSwapKeys] = useState(false);
  const [soundConfig, setSoundConfig] = useState<SoundConfig>({});
  const [adminOpen, setAdminOpen] = useState(false);
  const [adminAllowed, setAdminAllowed] = useState(false);
  const [adminNote, setAdminNote] = useState('');
  const [openMoment, setOpenMoment] = useState<Moment | null>(null);
  const [adminTab, setAdminTab] = useState<'moments' | 'files'>('moments');
  const [blockChoice, setBlockChoice] = useState<BlockChoice>('random');
  const [blockStyle, setBlockStyle] = useState<BlockStyle>('classic');
  const blockChoiceRef = useRef<BlockChoice>('random');
  const [demo, setDemo] = useState<Demo>(freshDemo);
  const tourRef = useRef(false);
  /* Расшифрованные дорожки и их копии, сдвинутые по высоте. Первый показ
     звука идёт ещё через <audio>, дальше — уже отсюда. */
  const bufferRef = useRef(new Map<string, AudioBuffer | 'ждёт' | 'нет'>());
  const pitchedRef = useRef(new Map<string, AudioBuffer>());
  const soundConfigRef = useRef<SoundConfig>({});
  const [fileTweaks, setFileTweaks] = useState<Record<string, FileTweak>>({});
  const [addedSounds, setAddedSounds] = useState<Record<string, string>>({});
  const [hiddenSounds, setHiddenSounds] = useState<string[]>([]);
  const fileTweaksRef = useRef<Record<string, FileTweak>>({});
  const addedSoundsRef = useRef<Record<string, string>>({});
  const hiddenRef = useRef<string[]>([]);
  const [allScores, setAllScores] = useState<GlobalScore[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const [quake, setQuake] = useState<Quake>({ tick: 0, power: 0 });
  const quakeTimerRef = useRef<number | null>(null);
  const musicRef = useRef<{ context: AudioContext; timer: number; step: number } | null>(null);
  const effectsContextRef = useRef<AudioContext | null>(null);
  const activeSoundsRef = useRef<Set<HTMLAudioElement>>(new Set());
  const nextSoundTimeRef = useRef(0);
  const soundSideRef = useRef(1);
  const soundsWantedRef = useRef(true);
  const musicWantedRef = useRef(true);
  const swipeRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const leaderboardTokenRef = useRef('');
  const submittedRef = useRef(false);
  const dailyBestRef = useRef(0);
  const flashTimerRef = useRef<number | null>(null);
  const lastEasterRef = useRef(0);
  const level = Math.floor(pieces / 8) + 1;

  const showFlash = useCallback((text: string) => {
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    setFlash({ id: Date.now(), text, tone: Math.floor(Math.random() * 4) });
    flashTimerRef.current = window.setTimeout(() => setFlash(null), 1250);
  }, []);

  // Alternating animation names restart the CSS shake even when a cascade
  // fires again before the previous one has finished.
  const shake = useCallback((power: number) => {
    setQuake(previous => ({ tick: previous.tick + 1, power: Math.min(3, Math.max(1, power)) }));
    if (quakeTimerRef.current !== null) window.clearTimeout(quakeTimerRef.current);
    quakeTimerRef.current = window.setTimeout(() => setQuake({ tick: 0, power: 0 }), 420);
  }, []);

  const refreshScores = useCallback(() => {
    void fetch('/api/leaderboard/scores?game=tetcolor&period=all&limit=5')
      .then(response => response.json() as Promise<{ scores?: GlobalScore[] }>)
      .then(data => setAllScores(data.scores ?? []))
      .catch(() => undefined);
  }, []);

  /* Everything below is read out of localStorage, which does not exist while
     the page is rendered on the server. There is no initial-state form of
     this: the first paint has to be the neutral one, and the stored values
     land on the render after mount. */
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLocalBest(Number(window.localStorage.getItem('tetcolor-columns-best') || 0));
    setSwapKeys(window.localStorage.getItem('tetcolor-controls') === 'swapped');
    const admin = window.location.hash === '#admin' || new URLSearchParams(window.location.search).has('admin');
    setAdminAllowed(admin);
    /* Вид фишек больше не запоминается между заходами: каждая загрузка бросает
       заново. Раньше нажатие на образец в панели закрепляло вид навсегда, а
       снять его можно было только там же — куда игрок не заходит. Один
       случайный тычок месяц назад означал один и тот же вид до конца времён.
       Закрепить на один заход по-прежнему можно ссылкой: ?blocks=neon.
       Старый ключ вычищается, чтобы закрепление у тех, кто уже наступил,
       умерло само. */
    window.localStorage.removeItem(BLOCK_KEY);
    const asked = new URLSearchParams(window.location.search).get('blocks') ?? '';
    const choice: BlockChoice = isBlockStyle(asked) ? asked : 'random';
    blockChoiceRef.current = choice;
    setBlockChoice(choice);
    const previous = window.localStorage.getItem(LAST_KEY) ?? '';
    const rolled = choice === 'random' ? rollBlocks(isBlockStyle(previous) ? previous : undefined) : choice;
    window.localStorage.setItem(LAST_KEY, rolled);
    setBlockStyle(rolled);
    setAdminOpen(admin);
    try {
      const saved = readConfig(window.localStorage.getItem(CONFIG_KEY));
      soundConfigRef.current = saved;
      setSoundConfig(saved);
      const tweaks = readJson<Record<string, FileTweak>>(TWEAK_KEY, {});
      const added = readJson<Record<string, string>>(ADDED_KEY, {});
      const hidden = readJson<string[]>(HIDDEN_KEY, []);
      fileTweaksRef.current = tweaks; addedSoundsRef.current = added; hiddenRef.current = hidden;
      setFileTweaks(tweaks); setAddedSounds(added); setHiddenSounds(hidden);
    } catch { /* A corrupt config must not stop the game from starting. */ }
    const enabled = window.localStorage.getItem('tetcolor-sounds') !== 'off';
    soundsWantedRef.current = enabled;
    setSoundsOn(enabled);
    dailyBestRef.current = Number(window.localStorage.getItem(`tetcolor-daily-best:${moscowDay()}`) || 0);
    refreshScores();
    pickBurst();
    // A relative path keeps the scope at /tetcolor/ behind the site proxy.
    if ('serviceWorker' in navigator) void navigator.serviceWorker.register('sw.js', { scope: './' }).catch(() => undefined);
  }, [refreshScores]);

  const resolveFile = useCallback((moment: Moment) => {
    const setting = soundConfigRef.current[moment];
    const pool = (setting?.files.length ? setting.files : defaultsFor(moment))
      .filter(file => !hiddenRef.current.includes(baseName(file)));
    // Hiding every sound for a moment means silence, not a fallback that
    // resurrects the very file that was hidden.
    return pool.length ? pool[Math.floor(Math.random() * pool.length)] : null;
  }, []);

  const applyEffects = useCallback((context: AudioContext, source: AudioNode, effects: Effects, src: string) => {
    let node: AudioNode = source;
    let trim = 1;
    if (effects.crush) {
      trim *= CRUSH_TRIM[baseName(src).replace('sounds/', '')] ?? .3;
      const shaper = context.createWaveShaper();
      shaper.curve = CRUSH_CURVE;
      shaper.oversample = '4x';
      node.connect(shaper);
      node = shaper;
    }
    if (effects.wide && 'createStereoPanner' in context) {
      // Haas: the same hit a few milliseconds later in the other ear reads wide.
      const merge = context.createGain();
      const left = context.createStereoPanner();
      const right = context.createStereoPanner();
      const delay = context.createDelay();
      left.pan.value = -1; right.pan.value = 1; delay.delayTime.value = .018;
      node.connect(left); left.connect(merge);
      node.connect(delay); delay.connect(right); right.connect(merge);
      node = merge;
    }
    if (effects.reverb) {
      trim *= REVERB_TRIM;
      const mix = context.createGain();
      const wet = context.createGain();
      const dry = context.createGain();
      const convolver = context.createConvolver();
      wet.gain.value = .6; dry.gain.value = .8;
      convolver.buffer = reverbImpulse(context);
      node.connect(dry); dry.connect(mix);
      node.connect(convolver); convolver.connect(wet); wet.connect(mix);
      node = mix;
    }
    return { node, trim };
  }, []);

  const loadBuffer = useCallback((context: BaseAudioContext, src: string, url: string) => {
    if (bufferRef.current.has(src)) return;
    bufferRef.current.set(src, 'ждёт');
    void fetch(url)
      .then(response => response.arrayBuffer())
      .then(bytes => context.decodeAudioData(bytes))
      .then(buffer => src.startsWith(ADDED_PREFIX) ? deRoom(context, buffer) : buffer)
      .then(buffer => { bufferRef.current.set(src, buffer); })
      .catch(() => { bufferRef.current.set(src, 'нет'); });
  }, []);

  /* Сдвиг считается один раз на пару «дорожка + высота», округлённую до
     сотой: разброс тона даёт бесконечно много близких значений, а на слух
     они неразличимы. */
  const pitchedBuffer = useCallback((context: BaseAudioContext, src: string, base: AudioBuffer, ratio: number) => {
    if (Math.abs(ratio - 1) < .005) return base;
    const key = `${src}@${ratio.toFixed(2)}`;
    const known = pitchedRef.current.get(key);
    if (known) return known;
    const made = stretchBuffer(context, base, ratio);
    if (pitchedRef.current.size > 120) pitchedRef.current.clear();
    pitchedRef.current.set(key, made);
    return made;
  }, []);

  const emit = useCallback((moment: Moment, options: SoundOptions = {}, override?: string) => {
    const setting = soundConfigRef.current[moment] ?? blankFor(moment);
    const scale = setting.volume;
    const base = moment === 'egg' ? .62 : .5;
    const picked = override ?? resolveFile(moment);
    if (!picked) return;
    [picked].forEach(src => {
      try {
        const url = src.startsWith(ADDED_PREFIX) ? addedSoundsRef.current[src] : src;
        const context = effectsContextRef.current ?? createAudioContext();
        effectsContextRef.current = context;
        void context.resume().catch(() => undefined);
        const tweak = fileTweaksRef.current[baseName(src)] ?? BLANK_TWEAK;
        const drift = Math.random() * 2 - 1;
        const spread = 1 + drift * Math.abs(drift) * setting.pitch;
        const ratio = Math.max(.25, Math.min(4, (options.pitch ?? 1) * spread));
        const ready = bufferRef.current.get(src);
        const buffer = ready instanceof AudioBuffer ? ready : null;
        if (!buffer) loadBuffer(context, src, url);
        const audio = buffer ? null : new Audio(url);
        if (audio) audio.preload = 'auto';
        const head: AudioNode = buffer
          ? (() => { const node = context.createBufferSource(); node.buffer = pitchedBuffer(context, src, buffer, ratio); node.playbackRate.value = ratio; return node; })()
          : context.createMediaElementSource(audio as HTMLAudioElement);
        const gain = context.createGain();
        const effects: Effects = setting.random
          ? { reverb: false, crush: false, wide: false, [(['reverb', 'crush', 'wide'] as const)[Math.floor(Math.random() * 3)]]: true }
          : { reverb: setting.reverb, crush: setting.crush, wide: setting.wide };
        const shaped = applyEffects(context, head, effects, src);
        const level = LEVEL_TRIM[baseName(src).replace('sounds/', '')] ?? 1;
        gain.gain.value = Math.min(8, (options.volume ?? base) * scale * shaped.trim * tweak.gain * level);
        const pan = !effects.wide && 'createStereoPanner' in context ? context.createStereoPanner() : null;
        if (pan) {
          pan.pan.value = Math.max(-1, Math.min(1, options.pan ?? soundSideRef.current * .3));
          soundSideRef.current *= -1;
          shaped.node.connect(pan); pan.connect(gain);
        } else shaped.node.connect(gain);
        gain.connect(masterBus(context));
        const scheduledAt = Math.max(context.currentTime, nextSoundTimeRef.current) + (options.delay ?? 0);
        nextSoundTimeRef.current = scheduledAt + .055;
        if (!audio) {
          /* Дорожка уже растянута под свою высоту, поэтому скорость здесь
             только возвращает длину на место. */
          (head as AudioBufferSourceNode).start(scheduledAt);
          return;
        }
        // Chrome preserves pitch by default, so playbackRate time-stretches
        // instead of transposing. Only the first play of a sound comes through
        // here, before its buffer is decoded.
        audio.preservesPitch = false;
        audio.playbackRate = ratio;
        const wait = Math.max(0, (scheduledAt - context.currentTime) * 1000);
        activeSoundsRef.current.add(audio);
        const release = () => activeSoundsRef.current.delete(audio);
        audio.addEventListener('ended', release, { once: true });
        audio.addEventListener('error', release, { once: true });
        const begin = () => {
          if (!soundsWantedRef.current) return release();
          void audio.play().catch(release);
        };
        if (wait < 12) begin(); else window.setTimeout(begin, wait);
      } catch {
        // Some Android WebViews reject MediaElementSource; effects are lost but
        // the sound still plays through the bare element.
        try {
          const fallback = new Audio(src);
          fallback.volume = Math.max(0, Math.min(1, (options.volume ?? base) * scale * (LEVEL_TRIM[baseName(src).replace('sounds/', '')] ?? 1)));
          fallback.playbackRate = Math.max(.65, Math.min(1.8, options.pitch ?? 1));
          const begin = () => { if (soundsWantedRef.current) void fallback.play().catch(() => undefined); };
          if ((options.delay ?? 0) > 0) window.setTimeout(begin, (options.delay ?? 0) * 1000);
          else begin();
        } catch { /* Sound is optional when device policy blocks playback. */ }
      }
    });
  }, [applyEffects, loadBuffer, pitchedBuffer, resolveFile]);

  const playSound = useCallback((sound: Sound, options: SoundOptions = {}) => {
    try {
      const pattern: Record<Sound, number | number[]> = {
        start: 18, move: 7, cycle: 10, land: 24,
        clear: [20, 28, 38], level: [22, 24, 22], gameover: [55, 40, 75],
      };
      navigator.vibrate?.(pattern[sound]);
    } catch { /* Haptics are optional and unsupported by iOS browsers. */ }
    if (!soundsWantedRef.current) return;
    emit(sound, options);
  }, [emit]);

  const playClearSound = useCallback((blocks: number, cascade: number) => {
    const scale = Math.min(1.65, 1 + Math.max(0, blocks - 3) * .055 + Math.max(0, cascade - 1) * .13);
    const power = Math.min(.8, .5 + Math.max(0, blocks - 3) * .04 + Math.max(0, cascade - 1) * .06);
    playSound('clear', { pitch: scale, volume: power, pan: -.3 });
    if (blocks > 3 || cascade > 1) playSound('clear', { pitch: scale * 1.11, volume: power * .72, delay: .075, pan: .3 });
    if (blocks >= 6 || cascade >= 3) playSound('clear', { pitch: scale * 1.2, volume: power * .55, delay: .14, pan: 0 });
  }, [playSound]);

  const playEaster = useCallback((chance = .12) => {
    if (!soundsWantedRef.current || Math.random() > chance || Date.now() - lastEasterRef.current < 18000) return;
    lastEasterRef.current = Date.now();
    emit('egg', { volume: .86, delay: .09 });
  }, [emit]);

  const toggleSounds = useCallback(() => {
    const enabled = !soundsWantedRef.current;
    soundsWantedRef.current = enabled;
    setSoundsOn(enabled);
    window.localStorage.setItem('tetcolor-sounds', enabled ? 'on' : 'off');
    if (!enabled) {
      activeSoundsRef.current.forEach(audio => { audio.pause(); audio.currentTime = 0; });
      activeSoundsRef.current.clear();
      if (effectsContextRef.current) { void effectsContextRef.current.close(); effectsContextRef.current = null; }
      nextSoundTimeRef.current = 0;
    }
    if (enabled) playSound('cycle');
  }, [playSound]);

  const stopMusic = useCallback(() => {
    const music = musicRef.current;
    if (!music) return;
    window.clearInterval(music.timer);
    void music.context.close();
    musicRef.current = null;
    setMusicOn(false);
  }, []);

  const startMusic = useCallback(() => {
    if (musicRef.current) return;
    try {
    const context = createAudioContext();
    void context.resume().catch(() => undefined);
    const master = context.createGain();
    master.gain.value = 0.045;
    master.connect(context.destination);
    const melody = [
      659.25, 659.25, 587.33, 523.25, 523.25, 587.33, 523.25, 493.88, 440, 0, 440, 493.88, 523.25, 587.33, 659.25, 0,
      659.25, 659.25, 587.33, 523.25, 523.25, 587.33, 523.25, 493.88, 440, 0, 659.25, 783.99, 880, 783.99, 659.25, 0,
    ];
    const bass = [55, 65.41, 49, 55];
    const voice = (frequency: number, type: OscillatorType, volume: number, duration: number, now: number) => {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = type;
      oscillator.frequency.value = frequency;
      envelope.gain.setValueAtTime(0.0001, now);
      envelope.gain.exponentialRampToValueAtTime(volume, now + 0.012);
      envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration);
      oscillator.connect(envelope); envelope.connect(master);
      oscillator.start(now); oscillator.stop(now + duration + 0.02);
    };
    const tick = () => {
      const music = musicRef.current;
      if (!music) return;
      const now = context.currentTime;
      const step = music.step++;
      const note = melody[step % melody.length];
      if (note) {
        voice(note, 'square', 0.12, 0.12, now);
        voice(note / 2, 'triangle', 0.055, 0.2, now);
      }
      if (step % 4 === 0) voice(bass[Math.floor(step / 8) % bass.length], 'sawtooth', 0.28, 0.42, now);
      if (step % 4 === 0) {
        const kick = context.createOscillator();
        const kickGain = context.createGain();
        kick.frequency.setValueAtTime(105, now);
        kick.frequency.exponentialRampToValueAtTime(42, now + 0.12);
        kickGain.gain.setValueAtTime(0.55, now);
        kickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.16);
        kick.connect(kickGain); kickGain.connect(master);
        kick.start(now); kick.stop(now + 0.17);
      }
    };
    musicRef.current = { context, timer: window.setInterval(tick, 145), step: 0 };
    tick();
    setMusicOn(true);
    } catch {
      // The game must still start when an Android browser blocks Web Audio.
      setMusicOn(false);
    }
  }, []);

  const toggleMusic = useCallback(() => {
    if (musicRef.current) {
      musicWantedRef.current = false;
      stopMusic();
    } else {
      musicWantedRef.current = true;
      startMusic();
    }
  }, [startMusic, stopMusic]);

  const togglePause = useCallback(() => {
    if (!started || gameOver) return;
    if (running) {
      stopMusic();
      setRunning(false);
    } else {
      setRunning(true);
      if (musicWantedRef.current) startMusic();
    }
  }, [gameOver, running, started, startMusic, stopMusic]);

  const resumeAudio = useCallback(() => {
    if (effectsContextRef.current?.state === 'suspended') void effectsContextRef.current.resume().catch(() => undefined);
    if (musicRef.current?.context.state === 'suspended') void musicRef.current.context.resume().catch(() => undefined);
  }, []);

  useEffect(() => {
    const unlock = () => resumeAudio();
    const restore = () => { if (!document.hidden) resumeAudio(); };
    window.addEventListener('pointerdown', unlock, { passive: true });
    window.addEventListener('touchstart', unlock, { passive: true });
    window.addEventListener('keydown', unlock);
    window.addEventListener('pageshow', unlock);
    document.addEventListener('visibilitychange', restore);
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('touchstart', unlock);
      window.removeEventListener('keydown', unlock);
      window.removeEventListener('pageshow', unlock);
      document.removeEventListener('visibilitychange', restore);
    };
  }, [resumeAudio]);

  useEffect(() => () => {
    const music = musicRef.current;
    if (music) { window.clearInterval(music.timer); void music.context.close(); }
    activeSoundsRef.current.forEach(audio => audio.pause());
    activeSoundsRef.current.clear();
    if (effectsContextRef.current) void effectsContextRef.current.close();
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
    if (quakeTimerRef.current !== null) window.clearTimeout(quakeTimerRef.current);
  }, []);

  const restart = useCallback(() => {
    submittedRef.current = false;
    leaderboardTokenRef.current = '';
    void fetch('/api/leaderboard/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'tetcolor' }) }).then(response => response.json() as Promise<{ token?: string }>).then(data => { leaderboardTokenRef.current = data.token ?? ''; }).catch(() => undefined);
    window.umami?.track('game-start', { game: 'tetcolor' });
    if (blockChoiceRef.current === 'random') setBlockStyle(current => { const next = rollBlocks(current); window.localStorage.setItem(LAST_KEY, next); return next; });
    setBoard(emptyBoard()); setPiece(newPiece()); setScore(0); setPieces(0); setGameOver(false); setRunning(true); setStarted(true); setClearing(new Set()); setResolving(false);
    setMessage('Собирай три одинаковых цвета в линию.');
    if (!musicRef.current) startMusic();
    playSound('start');
  }, [playSound, startMusic]);

  const requestRestart = useCallback(() => {
    if (started && !gameOver && !window.confirm('Начать новую игру? Текущий результат будет потерян.')) return;
    restart();
  }, [gameOver, restart, started]);

  const drop = useCallback(() => {
    if (!running || gameOver || resolving) return;
    setPiece((active) => {
      if (canPlace(board, active, active.x, active.y + 1)) return { ...active, y: active.y + 1 };
      if (active.y < 0) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); playSound('gameover'); shake(3); return active; }
      playSound('land');
      const placed = board.map((row) => [...row]);
      active.colors.forEach((color, index) => {
        const x = active.x + (active.horizontal ? index : 0);
        const y = active.y + (active.horizontal ? 0 : index);
        if (y >= 0) placed[y][x] = color;
      });
      const finishTurn = (result: TurnResult) => {
        setBoard(result.board);
        setClearing(new Set());
        setResolving(false);
        if (result.points) {
          setScore((value) => {
            const nextValue = value + result.points;
            if (Math.floor(nextValue / 100) > Math.floor(value / 100)) { showFlash(`${Math.floor(nextValue / 100) * 100} ОЧКОВ!`); playEaster(.3); }
            else if (result.cascade > 1) { showFlash(`КАСКАД ×${result.cascade}!`); playEaster(.18); }
            else if (Math.random() < .28) showFlash(BONUS_PHRASES[Math.floor(Math.random() * BONUS_PHRASES.length)]);
            return nextValue;
          });
          setMessage(result.cascade > 1 ? `Каскад ×${result.cascade}!` : `Линия уничтожена: +${result.points}`);
        }
        setPieces((value) => {
          const nextValue = value + 1;
          if (Math.floor(nextValue / 8) > Math.floor(value / 8)) { playSound('level'); showFlash(`УРОВЕНЬ ${Math.floor(nextValue / 8) + 1}!`); playEaster(.4); shake(2); }
          return nextValue;
        });
        const next = newPiece();
        if (!canPlace(result.board, next)) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); playSound('gameover'); shake(3); }
        return next;
      };
      const matched = findMatches(placed);
      if (matched.size) {
        setResolving(true);
        const animateCascade = (cascadeBoard: Board, cascade: number, points: number) => {
          const cascadeMatches = findMatches(cascadeBoard);
          if (!cascadeMatches.size) {
            setPiece(finishTurn({ board: cascadeBoard, points, cascade: cascade - 1 }));
            return;
          }
          setBoard(cascadeBoard);
          pickBurst();
          setClearing(cascadeMatches);
          playClearSound(cascadeMatches.size, cascade);
          shake(cascade + (cascadeMatches.size >= 6 ? 1 : 0));
          setMessage(cascade === 1 ? 'Совпадение!' : `Каскад ×${cascade}!`);
          window.setTimeout(() => {
            const clearedBoard = cascadeBoard.map((row, y) => row.map((cell, x) => cascadeMatches.has(`${x}:${y}`) ? null : cell));
            const collapsedBoard = collapse(clearedBoard);
            const nextPoints = points + cascadeMatches.size * cascadeMatches.size * 2 ** (cascade - 1);
            setBoard(collapsedBoard);
            setClearing(new Set());
            window.setTimeout(() => animateCascade(collapsedBoard, cascade + 1, nextPoints), 140);
          }, 420);
        };
        animateCascade(placed, 1, 0);
        return active;
      }
      return finishTurn({ board: placed, points: 0, cascade: 0 });
    });
  }, [board, gameOver, playClearSound, playEaster, playSound, resolving, running, shake, showFlash]);

  const move = useCallback((direction: number) => {
    if (running && !gameOver && !resolving) setPiece((active) => {
      if (!canPlace(board, active, active.x + direction)) return active;
      playSound('move');
      return { ...active, x: active.x + direction };
    });
  }, [board, gameOver, playSound, resolving, running]);
  const cycle = useCallback(() => { if (running && !gameOver && !resolving) { playSound('cycle'); setPiece((active) => ({ ...active, colors: [active.colors[1], active.colors[2], active.colors[0]] })); } }, [gameOver, playSound, resolving, running]);
  const hardDrop = useCallback(() => {
    if (!running || gameOver || resolving) return;
    setPiece((active) => { let y = active.y; while (canPlace(board, active, active.x, y + 1)) y += 1; return { ...active, y }; });
    window.setTimeout(drop, 0);
  }, [board, drop, gameOver, resolving, running]);

  const swipeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'mouse') return;
    swipeRef.current = { x: event.clientX, y: event.clientY, moved: false };
    try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Android WebView fallback */ }
  }, []);

  const swipeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = swipeRef.current;
    if (!drag || event.pointerType === 'mouse' || !running || gameOver || resolving) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const horizontalStep = (bounds.width / WIDTH) * 0.9;
    const verticalStep = (bounds.height / HEIGHT) * 0.72;
    const dx = event.clientX - drag.x;
    const dy = event.clientY - drag.y;
    if (Math.abs(dx) >= horizontalStep && Math.abs(dx) > Math.abs(dy)) {
      drag.moved = true;
      const steps = Math.trunc(dx / horizontalStep);
      for (let index = 0; index < Math.abs(steps); index += 1) move(steps > 0 ? 1 : -1);
      drag.x += steps * horizontalStep;
      drag.y = event.clientY;
    } else if (Math.abs(dy) >= verticalStep) {
      drag.moved = true;
      if (dy > 0) drop(); else cycle();
      drag.y += Math.sign(dy) * verticalStep;
      drag.x = event.clientX;
    }
  }, [cycle, drop, gameOver, move, resolving, running]);

  const swipeEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = swipeRef.current;
    swipeRef.current = null;
    if (event.pointerType !== 'mouse' && drag && !drag.moved) cycle();
  }, [cycle]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (adminOpen) return;
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowDown') drop();
      if (event.key === 'ArrowUp') { if (swapKeys) hardDrop(); else cycle(); }
      if (event.key === ' ') { if (swapKeys) cycle(); else hardDrop(); }
      if ((event.code === 'KeyP' || ['p', 'з'].includes(event.key.toLowerCase())) && !event.repeat) { event.preventDefault(); togglePause(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [adminOpen, cycle, drop, hardDrop, move, swapKeys, togglePause]);
  useEffect(() => { if (!running || gameOver) return; const id = window.setInterval(() => { if (!tourRef.current) drop(); }, Math.max(125, 620 - (level - 1) * 50)); return () => window.clearInterval(id); }, [drop, gameOver, level, running]);
  useEffect(() => { if (gameOver) stopMusic(); }, [gameOver, stopMusic]);
  useEffect(() => {
    if (gameOver && !submittedRef.current) {
      submittedRef.current = true;
      window.umami?.track('game-finish', { game: 'tetcolor', score });
      const token = leaderboardTokenRef.current;
      const isDailyRecord = score > 0 && score > dailyBestRef.current;
      if (token && isDailyRecord) {
        void window.requestPlayerName()
          .then(nickname => fetch('/api/leaderboard/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nickname, score }) }))
          .then(response => {
            if (!response.ok) throw new Error(`сервер ответил ${response.status}`);
            /* The day is marked only once the board actually has the score.
               Marking it before the request meant a single dropped connection
               silenced that player until Moscow midnight, with nothing on
               screen to say so and the failure swallowed. */
            dailyBestRef.current = score;
            window.localStorage.setItem(`tetcolor-daily-best:${moscowDay()}`, String(score));
            return refreshScores();
          })
          .catch((error: unknown) => { console.warn('Результат не отправлен, попробуем со следующей партии', error); });
      }
    }
    /* The personal best is written where the game ends rather than where the
       points are added, because the score is still being folded in by the
       cascade at that point and would be read short. */
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (gameOver && score > localBest) { window.localStorage.setItem('tetcolor-columns-best', String(score)); setLocalBest(score); }
  }, [gameOver, localBest, refreshScores, score]);

  const visibleBoard = useMemo(() => board.map((row, y) => row.map((cell, x) => {
    const index = resolving ? -1 : piece.colors.findIndex((_, part) => piece.x + (piece.horizontal ? part : 0) === x && piece.y + (piece.horizontal ? 0 : part) === y);
    return index >= 0 ? piece.colors[index] : cell;
  })), [board, piece, resolving]);

  const updateSetting = (moment: Moment, patch: Partial<SoundSetting>) => {
    const current = soundConfigRef.current[moment] ?? BLANK;
    const next = { ...soundConfigRef.current, [moment]: { ...current, ...patch } };
    soundConfigRef.current = next;
    setSoundConfig(next);
    window.localStorage.setItem(CONFIG_KEY, JSON.stringify(next));
  };

  const persist = <T,>(key: string, value: T, ref: { current: T }, set: (value: T) => void) => {
    ref.current = value;
    set(value);
    try { window.localStorage.setItem(key, JSON.stringify(value)); }
    catch { setAdminNote('Не хватило места в браузере — удалите лишние добавленные звуки'); }
  };

  const updateTweak = (file: string, patch: Partial<FileTweak>) => {
    const current = fileTweaksRef.current[file] ?? BLANK_TWEAK;
    persist(TWEAK_KEY, { ...fileTweaksRef.current, [file]: { ...current, ...patch } }, fileTweaksRef, setFileTweaks);
  };

  const toggleHidden = (file: string) => {
    const list = hiddenRef.current;
    persist(HIDDEN_KEY, list.includes(file) ? list.filter(x => x !== file) : [...list, file], hiddenRef, setHiddenSounds);
  };

  const removeAdded = (file: string) => {
    const rest = { ...addedSoundsRef.current };
    delete rest[file];
    persist(ADDED_KEY, rest, addedSoundsRef, setAddedSounds);
    MOMENT_ORDER.forEach(moment => {
      const files = soundConfigRef.current[moment]?.files;
      if (files?.includes(file)) updateSetting(moment, { files: files.filter(x => x !== file) });
    });
  };

  const addFiles = async (list: FileList | null) => {
    if (!list?.length) return;
    const next = { ...addedSoundsRef.current };
    let skipped = 0;
    for (const file of Array.from(list)) {
      // Base64 in localStorage is fine for short effects and nothing else.
      if (file.size > 300_000) { skipped += 1; continue; }
      next[ADDED_PREFIX + file.name] = await new Promise<string>(resolve => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(file);
      });
    }
    persist(ADDED_KEY, next, addedSoundsRef, setAddedSounds);
    setAdminNote(skipped ? `Пропущено ${skipped}: тяжелее 300 КБ` : 'Добавлено. Чтобы услышали все — пришлите мне эти файлы');
  };

  const toggleFile = (moment: Moment, file: string) => {
    const chosen = soundConfigRef.current[moment]?.files ?? [];
    updateSetting(moment, { files: chosen.includes(file) ? chosen.filter(x => x !== file) : [...chosen, file] });
  };

  // The config lives in one browser. Copying it out is how a tuned setup can
  // become the default everyone hears.
  const copySounds = () => {
    const text = JSON.stringify(soundConfigRef.current, null, 2);
    void navigator.clipboard?.writeText(text).then(() => setAdminNote('Скопировано — пришлите мне, и станет настройкой по умолчанию'))
      .catch(() => setAdminNote(text));
  };

  const resetSounds = () => {
    soundConfigRef.current = {};
    setSoundConfig({});
    window.localStorage.removeItem(CONFIG_KEY);
  };

  useEffect(() => {
    if (!adminOpen) return;
    const timer = window.setInterval(() => setDemo(stepDemo), 260);
    return () => window.clearInterval(timer);
  }, [adminOpen]);

  const runTour = useCallback(() => {
    /* The freeze is only ever set when there is something to unfreeze it: if
       the shared script did not load, or there is nothing left to show, an
       optimistic flag here would stop gravity for the rest of the game. */
    const tour = window.Tour;
    const steps = visibleSteps();
    if (!tour || !steps.length) return;
    tourRef.current = true;
    tour.start(steps, { onEnd: () => { tourRef.current = false; } });
  }, []);

  useEffect(() => {
    if (!started) return;
    const tour = window.Tour;
    if (!tour || tour.seen('tetcolor')) return;
    /* Let the first column fall into view before freezing: pointing at an
       empty well and saying "the pieces land here" teaches nothing. */
    const id = window.setTimeout(() => {
      /* В ландшафте вместо игры стоит «поверни телефон», и стакан за ним не
         виден. Обучение показывается один раз на устройство, так что потратить
         этот раз на карточку поверх заглушки — значит не показать его вовсе. */
      if (window.matchMedia('(max-width: 900px) and (orientation: landscape)').matches) return;
      const steps = visibleSteps();
      if (!steps.length) return;
      tourRef.current = true;
      tour.once('tetcolor', steps, { onEnd: () => { tourRef.current = false; } });
    }, 1500);
    return () => window.clearTimeout(id);
  }, [started]);

  /* On the roll, the demo cycles through the looks by itself — otherwise the
     one thing the panel cannot show you is what the roll actually does. */
  useEffect(() => {
    if (!adminOpen || blockChoice !== 'random') return;
    const timer = window.setInterval(() => setBlockStyle(rollBlocks), 5200);
    return () => window.clearInterval(timer);
  }, [adminOpen, blockChoice]);

  /* Выбор в панели живёт до перезагрузки и не переживает её — иначе он снова
     станет ловушкой. Чтобы вид держался, есть ссылка ?blocks=. */
  const chooseBlocks = (next: BlockChoice) => {
    blockChoiceRef.current = next;
    setBlockChoice(next);
    setBlockStyle(current => (next === 'random' ? rollBlocks(current) : next));
  };

  const chooseScheme = (next: boolean) => {
    setSwapKeys(next);
    window.localStorage.setItem('tetcolor-controls', next ? 'swapped' : 'default');
  };

  const scoreList = (entries: GlobalScore[]) => <ol className="global-scores">{entries.length
    ? entries.map((entry, index) => <li key={`${entry.nickname}-${index}`}><span>{entry.nickname}</span><b>{entry.score}</b></li>)
    : <li className="empty">пока пусто</li>}</ol>;

  const colorWord = <><span className="color-c">C</span><span className="color-o">O</span><span className="color-l">L</span><span className="color-o2">O</span><span className="color-r">R</span></>;

  return <main>{!started && <div className="start-screen" data-blocks={blockStyle} role="dialog" aria-label="Начать игру">{/* eslint-disable-line @next/next/no-img-element -- next/image rewrites src; the relative path is exactly what makes this resolve under both / and /tetcolor/ */}<img className="start-sky" src="start-bg.jpg" alt="" aria-hidden="true" /><img className="start-floor" src="start-bg.jpg" alt="" aria-hidden="true" /><div className="start-veil" aria-hidden="true" /><div className="start-drift" aria-hidden="true">{DRIFT.map(cube => <span key={cube.look} data-blocks={cube.look} style={{ '--left': cube.left, '--size': `${cube.size}px`, '--time': `${cube.time}s`, '--delay': `${cube.delay}s`, '--sway': `${cube.sway}px`, '--sway-time': `${cube.swayTime}s`, '--spin': cube.spin } as React.CSSProperties}><i className="cell filled" style={{ '--cell': PALETTE[cube.colour] } as React.CSSProperties} /></span>)}</div><div className="start-card"><span className="acid-kicker">ACID COLUMNS · 1991</span><b>TET{colorWord}</b><p>Три кубика. Собирай линии. Меняй цвета тапом/стрелками.</p><div className="scheme-choice"><span>КЛАВИШИ</span><div><button type="button" className={swapKeys ? '' : 'active'} onClick={() => chooseScheme(false)}>↑ ЦВЕТА<small>ПРОБЕЛ — БРОСИТЬ</small></button><button type="button" className={swapKeys ? 'active' : ''} onClick={() => chooseScheme(true)}>↑ БРОСИТЬ<small>ПРОБЕЛ — ЦВЕТА</small></button></div></div><button type="button" onClick={restart}>СТАРТ</button></div></div>}<section className="cabinet" data-blocks={blockStyle} aria-label="Игра Tetcolor Columns">
    <header className="topline"><span>TET{colorWord}</span><span>ACID COLUMNS · 1991 → WEB</span><a className="game-home-menu" href="https://aka-gst.ru/">НА ГЛАВНУЮ</a></header>
    <div className="game-shell">
      <aside className="panel stats"><p className="eyebrow">СЧЁТ</p><strong>{score}</strong><p className="eyebrow">УРОВЕНЬ</p><strong>{level}</strong><p className="eyebrow">ЛУЧШИЙ НА ЭТОМ УСТРОЙСТВЕ</p><strong>{localBest}</strong><p className="eyebrow">ЗА ВСЁ ВРЕМЯ</p>{scoreList(allScores)}</aside>
      <div className="play-column"><div className={`well${quake.tick ? ` quake quake-${quake.tick % 2 ? 'a' : 'b'}` : ''}`} style={{ '--quake': quake.power } as React.CSSProperties} role="grid" aria-label="Игровое поле" onPointerDown={swipeStart} onPointerMove={swipeMove} onPointerUp={swipeEnd} onPointerCancel={() => { swipeRef.current = null; }} onContextMenu={(event) => event.preventDefault()}>{visibleBoard.flatMap((row, y) => row.map((cell, x) => <span key={`${x}-${y}`} className={`cell ${cell === null ? '' : 'filled'} ${clearing.has(`${x}:${y}`) ? 'clearing' : ''}`} style={cell === null ? undefined : { '--cell': PALETTE[cell] } as React.CSSProperties} />))}{quake.tick > 0 && <span key={quake.tick} className={`board-flash power-${quake.power}`} aria-hidden="true" />}{flash && <div key={flash.id} className={`score-flash tone-${flash.tone}`}>{flash.text}</div>}{started && !running && !gameOver && <div className="pause-screen"><b>ПАУЗА</b><span>P / З — продолжить</span><button onClick={togglePause}>ПРОДОЛЖИТЬ</button></div>}{gameOver && <img className="over-art" src="tetcolor-over.webp" alt="" aria-hidden="true" /> /* eslint-disable-line @next/next/no-img-element -- next/image rewrites src; the relative path is exactly what makes this resolve under both / and /tetcolor/ */}{gameOver && <div className="game-over"><b>ИГРА ОКОНЧЕНА</b><button onClick={restart}>ЕЩЁ РАЗ</button></div>}</div><div className="touch" aria-label="Сенсорное управление"><button onClick={() => move(-1)} aria-label="Влево">←<small>ВЛЕВО</small></button><button onClick={cycle} aria-label="Сменить цвета">↻<small>ЦВЕТА</small></button><button onClick={() => move(1)} aria-label="Вправо">→<small>ВПРАВО</small></button><button className="soft-drop" onClick={drop} aria-label="Опустить на одну клетку">↓<small>ШАГ</small></button><button className="hard-drop" onClick={hardDrop} aria-label="Бросить до конца">⇊<small>БРОСИТЬ</small></button></div><span className="swipe-hint">ТАП: ЦВЕТА · ТАЩИ: ← → ПО КЛЕТКАМ · ↓ ВНИЗ</span></div>
      <aside className="panel controls"><p className="eyebrow">{piece.horizontal ? 'ГОРИЗОНТАЛЬНЫЙ БЛОК' : 'КОЛОННА'}</p><div className={`preview ${piece.horizontal ? 'horizontal' : ''}`}>{piece.colors.map((color, index) => <i key={index} style={{ '--cell': PALETTE[color] } as React.CSSProperties} />)}</div><p className="message" aria-live="polite">{message}</p>{!running && !gameOver ? <button onClick={requestRestart}>НОВАЯ ИГРА</button> : <button onClick={togglePause}>{running ? 'ПАУЗА' : 'ПРОДОЛЖИТЬ'}</button>}<button className="music" onClick={toggleMusic}>{musicOn ? '♫ МУЗЫКА: ВКЛ' : '♫ МУЗЫКА: ВЫКЛ'}</button><button className="music" onClick={toggleSounds}>{soundsOn ? '◉ ЗВУКИ: ВКЛ' : '○ ЗВУКИ: ВЫКЛ'}</button>{started && <button className="music" onClick={runTour}>? КАК ИГРАТЬ</button>}{adminAllowed && <button className="music admin-open" onClick={() => setAdminOpen(true)}>⚙ НАСТРОЙКА ЗВУКОВ</button>}</aside>
    </div>
    <div className="keyboard"><span>← → движение</span><span>↑ {swapKeys ? 'бросить' : 'сменить цвета'}</span><span>↓ быстрее</span><span>ПРОБЕЛ {swapKeys ? 'сменить цвета' : 'бросить'}</span><button type="button" className="swap-keys" onClick={() => chooseScheme(!swapKeys)} title="Поменять местами ↑ и ПРОБЕЛ">⇄ ПОМЕНЯТЬ</button></div>
  </section>
  {adminOpen && <div className="admin-panel" role="dialog" aria-label="Настройка звуков"><div className="admin-card">
      <header>
        <b>НАСТРОЙКА ЗВУКОВ</b>
        <span className="admin-tabs">
          <button type="button" className={adminTab === 'moments' ? 'on' : ''} onClick={() => setAdminTab('moments')}>МОМЕНТЫ</button>
          <button type="button" className={adminTab === 'files' ? 'on' : ''} onClick={() => setAdminTab('files')}>ЗВУКИ</button>
        </span>
        <button type="button" onClick={() => setAdminOpen(false)}>ЗАКРЫТЬ</button>
      </header>
      <div className="admin-blocks">
        {/* Clicking a look to see it also pins it, and outside this panel there
            is nothing to say so — someone who tried one on weeks ago has been
            playing it ever since and wondering why the roll stopped. */}
        <span>ВИД ФИШЕК: {blockChoice === 'random'
          ? `СЛУЧАЙНЫЙ КАЖДУЮ ПАРТИЮ · СЕЙЧАС ${BLOCK_STYLES.find(([id]) => id === blockStyle)?.[1] ?? ''}`
          : `ЗАКРЕПЛЁН ${BLOCK_STYLES.find(([id]) => id === blockChoice)?.[1] ?? ''}`}</span>
        <button type="button" data-blocks={blockStyle} className={blockChoice === 'random' ? 'on' : ''} onClick={() => chooseBlocks('random')}>
          <span className="swatch">{[1, 0, 2].map(colour =>
            <i key={colour} className="cell filled" style={{ '--cell': PALETTE[colour] } as React.CSSProperties} />)}</span>
          СЛУЧАЙНО
        </button>
        {BLOCK_STYLES.map(([id, title]) =>
          <button key={id} type="button" data-blocks={id} className={blockChoice === id ? 'on' : ''} onClick={() => chooseBlocks(id)}>
            <span className="swatch">{[1, 0, 2].map(colour =>
              <i key={colour} className="cell filled" style={{ '--cell': PALETTE[colour] } as React.CSSProperties} />)}</span>
            {title}
          </button>)}
      </div>
      <div className="admin-body">
      <div className="admin-main">
      {adminTab === 'moments' && <div className="admin-rows">
        <span className="admin-head">МОМЕНТ</span><span className="admin-head">ЗВУКИ</span><span className="admin-head">ГРОМКОСТЬ</span><span className="admin-head">РАЗБРОС ТОНА</span><span className="admin-head">ЭФФЕКТЫ</span><span />
        {MOMENT_ORDER.map(moment => {
          const setting = soundConfig[moment] ?? blankFor(moment);
          const chosen = setting.files.length;
          const open = openMoment === moment;
          return <Fragment key={moment}>
            <span className="admin-moment">{SOUND_LABELS[moment]}</span>
            <button type="button" className={`admin-pick ${open ? 'open' : ''}`} onClick={() => setOpenMoment(open ? null : moment)}>
              {chosen ? `выбрано: ${chosen}` : 'по умолчанию'}
            </button>
            <label className="admin-volume"><input type="range" min={0} max={500} step={10} value={Math.round(setting.volume * 100)} onChange={event => updateSetting(moment, { volume: Number(event.target.value) / 100 })} /><b>{Math.round(setting.volume * 100)}%</b></label>
            <label className="admin-volume"><input type="range" min={0} max={50} step={1} value={Math.round(setting.pitch * 100)} onChange={event => updateSetting(moment, { pitch: Number(event.target.value) / 100 })} /><b>±{Math.round(setting.pitch * 100)}%</b></label>
            <span className="admin-fx">
              <label className={setting.random ? 'on' : ''} title="Каждый раз один случайный эффект"><input type="checkbox" checked={setting.random} onChange={event => updateSetting(moment, { random: event.target.checked })} />ЛЮБОЙ</label>
              {([['reverb', 'РЕВЕРБ'], ['crush', 'ИСКАЖ'], ['wide', 'ШИРЕ']] as const).map(([key, title]) =>
                <label key={key} className={`${setting[key] ? 'on' : ''} ${setting.random ? 'muted' : ''}`}><input type="checkbox" disabled={setting.random} checked={setting[key]} onChange={event => updateSetting(moment, { [key]: event.target.checked })} />{title}</label>)}
            </span>
            <button type="button" className="admin-play" onClick={() => emit(moment, moment === 'move' ? { volume: .3 } : undefined)} aria-label="Прослушать">▶</button>
            {open && <div className="admin-files">
              <div className="admin-files-top">
                <span>{chosen > 1 ? `${chosen} звука — каждый раз играет случайный` : chosen === 1 ? 'играет только отмеченный звук' : 'играют звуки по умолчанию — отметьте свои'}</span>
                {chosen > 0 && <button type="button" onClick={() => updateSetting(moment, { files: [] })}>очистить</button>}
              </div>
              {[...GROUPS, { title: 'ДОБАВЛЕННЫЕ', files: Object.keys(addedSounds) }].filter(group => group.files.length).map(group => <div key={group.title} className="admin-group">
                <span>{group.title}</span>
                <div>{group.files.filter(file => !hiddenSounds.includes(file)).map(file => <label key={file} className={`${setting.files.includes(file) ? 'on' : ''} ${MOMENT_ORDER.some(other => other !== moment && soundConfig[other]?.files.includes(file)) ? 'taken' : ''}`}>
                  <input type="checkbox" checked={setting.files.includes(file)} onChange={() => toggleFile(moment, file)} />
                  {fileLabel(file).replace(/^(eggs|custom)\//, '')}
                  <i title="Прослушать" onClick={event => { event.preventDefault(); event.stopPropagation(); emit(moment, { volume: .7 }, file); }} />
                </label>)}</div>
              </div>)}
            </div>}
          </Fragment>;
        })}
      </div>}
      {adminTab === 'files' && <div className="admin-library">
        <div className="admin-files-top">
          <span>Громкость и тон каждого звука отдельно. Подсвеченные уже назначены на момент.</span>
          <label className="admin-add">ДОБАВИТЬ<input type="file" accept="audio/*" multiple onChange={event => { void addFiles(event.target.files); event.target.value = ''; }} /></label>
        </div>
        {[...GROUPS, { title: 'ДОБАВЛЕННЫЕ', files: Object.keys(addedSounds) }].filter(group => group.files.length).map(group =>
          <div key={group.title} className="admin-lib-group">
            <span>{group.title}</span>
            {group.files.map(file => {
              const tweak = fileTweaks[file] ?? BLANK_TWEAK;
              const users = MOMENT_ORDER.filter(moment => soundConfig[moment]?.files.includes(file));
              const off = hiddenSounds.includes(file);
              return <div key={file} className={`admin-lib-row ${users.length ? 'used' : ''} ${off ? 'off' : ''}`}>
                <span className="admin-lib-name">{fileLabel(file).replace(/^(eggs|custom|added)\//, '')}
                  {users.length > 0 && <i>{users.map(moment => SOUND_LABELS[moment]).join(', ')}</i>}</span>
                <button type="button" className="admin-play" onClick={() => emit('move', { volume: .7 }, file)} aria-label="Прослушать">▶</button>
                <label className="admin-volume"><span>ГРОМК</span><input type="range" min={0} max={300} step={1} value={Math.round(tweak.gain * 100)} onChange={event => updateTweak(file, { gain: Number(event.target.value) / 100 })} /><b>{Math.round(tweak.gain * 100)}%</b></label>
                <button type="button" className="admin-hide" onClick={() => toggleHidden(file)}>{off ? 'ВЕРНУТЬ' : 'СКРЫТЬ'}</button>
                {file.startsWith(ADDED_PREFIX) && <button type="button" className="admin-hide" onClick={() => removeAdded(file)}>УДАЛИТЬ</button>}
              </div>;
            })}
          </div>)}
      </div>}
      </div>
      <aside className="admin-demo" data-blocks={blockStyle}>
        <span>КАК ЭТО ИГРАЕТСЯ</span>
        <div className="demo-well">
          {demo.board.flatMap((row, y) => row.map((cell, x) => {
            const active = demo.colors.findIndex((_, part) => demo.x === x && demo.y + part === y);
            const colour = active >= 0 ? demo.colors[active] : cell;
            return <span
              key={`${x}-${y}`}
              className={`cell ${colour === null ? '' : 'filled'} ${demo.clearing.includes(`${x}:${y}`) ? 'clearing' : ''}`}
              style={colour === null ? undefined : { '--cell': PALETTE[colour] } as React.CSSProperties}
            />;
          }))}
        </div>
      </aside>
      </div>
      <footer><button type="button" onClick={resetSounds}>СБРОСИТЬ ВСЁ</button><button type="button" onClick={copySounds}>СКОПИРОВАТЬ</button><small>{adminNote || 'Настройки хранятся только в этом браузере'}</small></footer>
    </div></div>}</main>;
}
