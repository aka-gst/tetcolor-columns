'use client';

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number>) => void };
    requestPlayerName: () => Promise<string>;
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
const PALETTE = ['#ff2bd6', '#efff00', '#00ff85', '#00d9ff', '#9b5cff'];
const BLOCK_STYLES = [
  ['classic', 'КЛАССИКА'],
  ['pixel', 'ПИКСЕЛЬ'],
  ['glass', 'СТЕКЛО'],
  ['outline', 'КОНТУР'],
  ['faceted', 'ОГРАНКА'],
] as const;
type BlockStyle = typeof BLOCK_STYLES[number][0];
const BLOCK_KEY = 'tetcolor-blocks';
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
const defaultsFor = (moment: Moment) => moment === 'egg' ? EASTER_FILES : SOUND_FILES[moment];

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
type SoundConfig = Partial<Record<Moment, SoundSetting>>;
const CONFIG_KEY = 'tetcolor-sound-config';
const TWEAK_KEY = 'tetcolor-file-tweaks';
const ADDED_KEY = 'tetcolor-added-sounds';
const HIDDEN_KEY = 'tetcolor-hidden-sounds';

// Per file rather than per moment: a badly recorded clip needs levelling and
// shaping wherever it is used, not once for each place it is used.
type FileTweak = { gain: number; low: number; mid: number; high: number };
const BLANK_TWEAK: FileTweak = { gain: 1, low: 0, mid: 0, high: 0 };
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

function resolve(board: Board) {
  let next = board;
  let points = 0;
  let cascade = 0;
  while (true) {
    const matched = findMatches(next);
    if (!matched.size) return { board: next, points, cascade };
    cascade += 1;
    points += matched.size * matched.size * 2 ** (cascade - 1);
    next = collapse(next.map((row, y) => row.map((cell, x) => matched.has(`${x}:${y}`) ? null : cell)));
  }
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
  const [blockStyle, setBlockStyle] = useState<BlockStyle>('classic');
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

  useEffect(() => {
    setLocalBest(Number(window.localStorage.getItem('tetcolor-columns-best') || 0));
    setSwapKeys(window.localStorage.getItem('tetcolor-controls') === 'swapped');
    const admin = window.location.hash === '#admin';
    setAdminAllowed(admin);
    const savedBlocks = window.localStorage.getItem(BLOCK_KEY) as BlockStyle | null;
    if (savedBlocks && BLOCK_STYLES.some(([id]) => id === savedBlocks)) setBlockStyle(savedBlocks);
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
    // Relative paths keep the scope at /tetcolor/ behind the site proxy.
    document.documentElement.style.setProperty('--burst', `url(${new URL('burst.png', document.baseURI).href})`);
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

  const emit = useCallback((moment: Moment, options: SoundOptions = {}, override?: string) => {
    const setting = soundConfigRef.current[moment] ?? blankFor(moment);
    const scale = setting.volume;
    const base = moment === 'move' ? .3 : moment === 'cycle' ? .42 : .58;
    const picked = override ?? resolveFile(moment);
    if (!picked) return;
    [picked].forEach(src => {
      try {
        const audio = new Audio(src.startsWith(ADDED_PREFIX) ? addedSoundsRef.current[src] : src);
        audio.preload = 'auto';
        const context = effectsContextRef.current ?? createAudioContext();
        effectsContextRef.current = context;
        void context.resume().catch(() => undefined);
        const source = context.createMediaElementSource(audio);
        const tweak = fileTweaksRef.current[baseName(src)] ?? BLANK_TWEAK;
        let head: AudioNode = source;
        if (tweak.low || tweak.mid || tweak.high) {
          ([['lowshelf', 240, tweak.low], ['peaking', 1200, tweak.mid], ['highshelf', 4200, tweak.high]] as const)
            .forEach(([type, frequency, value]) => {
              if (!value) return;
              const filter = context.createBiquadFilter();
              filter.type = type;
              filter.frequency.value = frequency;
              if (type === 'peaking') filter.Q.value = 1;
              filter.gain.value = value;
              head.connect(filter);
              head = filter;
            });
        }
        const gain = context.createGain();
        const effects: Effects = setting.random
          ? { reverb: false, crush: false, wide: false, [(['reverb', 'crush', 'wide'] as const)[Math.floor(Math.random() * 3)]]: true }
          : { reverb: setting.reverb, crush: setting.crush, wide: setting.wide };
        const shaped = applyEffects(context, head, effects, src);
        gain.gain.value = Math.min(8, (options.volume ?? base) * scale * shaped.trim * tweak.gain);
        const pan = !effects.wide && 'createStereoPanner' in context ? context.createStereoPanner() : null;
        if (pan) {
          pan.pan.value = Math.max(-1, Math.min(1, options.pan ?? soundSideRef.current * .3));
          soundSideRef.current *= -1;
          shaped.node.connect(pan); pan.connect(gain);
        } else shaped.node.connect(gain);
        gain.connect(masterBus(context));
        // Chrome preserves pitch by default, so playbackRate time-stretches
        // instead of transposing: on a 65 ms click that smears it into grit,
        // and the pitch spread changed nothing but the length.
        audio.preservesPitch = false;
        const drift = Math.random() * 2 - 1;
        const spread = 1 + drift * Math.abs(drift) * setting.pitch;
        audio.playbackRate = Math.max(.25, Math.min(4, (options.pitch ?? 1) * spread));
        const scheduledAt = Math.max(context.currentTime, nextSoundTimeRef.current) + (options.delay ?? 0);
        nextSoundTimeRef.current = scheduledAt + .055;
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
          fallback.volume = Math.max(0, Math.min(1, (options.volume ?? base) * scale));
          fallback.playbackRate = Math.max(.65, Math.min(1.8, options.pitch ?? 1));
          const begin = () => { if (soundsWantedRef.current) void fallback.play().catch(() => undefined); };
          if ((options.delay ?? 0) > 0) window.setTimeout(begin, (options.delay ?? 0) * 1000);
          else begin();
        } catch { /* Sound is optional when device policy blocks playback. */ }
      }
    });
  }, [applyEffects, resolveFile]);

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
    const power = Math.min(.92, .56 + Math.max(0, blocks - 3) * .045 + Math.max(0, cascade - 1) * .07);
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
    void fetch('/api/leaderboard/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ game: 'tetcolor' }) }).then(response => response.json()).then(data => { leaderboardTokenRef.current = data.token ?? ''; }).catch(() => undefined);
    window.umami?.track('game-start', { game: 'tetcolor' });
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
      const finishTurn = (result: ReturnType<typeof resolve>) => {
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
  useEffect(() => { if (!running || gameOver) return; const id = window.setInterval(drop, Math.max(125, 620 - (level - 1) * 50)); return () => window.clearInterval(id); }, [drop, gameOver, level, running]);
  useEffect(() => { if (gameOver) stopMusic(); }, [gameOver, stopMusic]);
  useEffect(() => {
    if (gameOver && !submittedRef.current) {
      submittedRef.current = true;
      window.umami?.track('game-finish', { game: 'tetcolor', score });
      const token = leaderboardTokenRef.current;
      const isDailyRecord = score > 0 && score > dailyBestRef.current;
      if (isDailyRecord) {
        dailyBestRef.current = score;
        window.localStorage.setItem(`tetcolor-daily-best:${moscowDay()}`, String(score));
      }
      if (token && isDailyRecord) void window.requestPlayerName().then(nickname => fetch('/api/leaderboard/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nickname, score }) })).then(refreshScores).catch(() => undefined);
    }
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

  const chooseBlocks = (next: BlockStyle) => {
    setBlockStyle(next);
    window.localStorage.setItem(BLOCK_KEY, next);
  };

  const chooseScheme = (next: boolean) => {
    setSwapKeys(next);
    window.localStorage.setItem('tetcolor-controls', next ? 'swapped' : 'default');
  };

  const scoreList = (entries: GlobalScore[]) => <ol className="global-scores">{entries.length
    ? entries.map((entry, index) => <li key={`${entry.nickname}-${index}`}><span>{entry.nickname}</span><b>{entry.score}</b></li>)
    : <li className="empty">пока пусто</li>}</ol>;

  const colorWord = <><span className="color-c">C</span><span className="color-o">O</span><span className="color-l">L</span><span className="color-o2">O</span><span className="color-r">R</span></>;

  return <main>{!started && <div className="start-screen" role="dialog" aria-label="Начать игру">{/* eslint-disable-line @next/next/no-img-element -- next/image rewrites src; the relative path is exactly what makes this resolve under both / and /tetcolor/ */}<img className="start-art-blur" src="start-bg.jpg" alt="" aria-hidden="true" /><img className="start-art" src="start-bg.jpg" alt="" aria-hidden="true" /><div className="start-card"><span className="acid-kicker">ACID COLUMNS · 1991</span><b>TET{colorWord}</b><p>Три кубика. Собирай линии. Меняй цвета тапом/стрелками.</p><div className="scheme-choice"><span>КЛАВИШИ</span><div><button type="button" className={swapKeys ? '' : 'active'} onClick={() => chooseScheme(false)}>↑ ЦВЕТА<small>ПРОБЕЛ — БРОСИТЬ</small></button><button type="button" className={swapKeys ? 'active' : ''} onClick={() => chooseScheme(true)}>↑ БРОСИТЬ<small>ПРОБЕЛ — ЦВЕТА</small></button></div></div><button type="button" onClick={restart}>СТАРТ</button></div></div>}<section className="cabinet" data-blocks={blockStyle} aria-label="Игра Tetcolor Columns">
    <header className="topline"><span>TET{colorWord}</span><span>ACID COLUMNS · 1991 → WEB</span><a className="game-home-menu" href="https://aka-gst.ru/">НА ГЛАВНУЮ</a></header>
    <div className="game-shell">
      <aside className="panel stats"><p className="eyebrow">СЧЁТ</p><strong>{score}</strong><p className="eyebrow">УРОВЕНЬ</p><strong>{level}</strong><p className="eyebrow">ЛУЧШИЙ НА ЭТОМ УСТРОЙСТВЕ</p><strong>{localBest}</strong><p className="eyebrow">ЗА ВСЁ ВРЕМЯ</p>{scoreList(allScores)}</aside>
      <div className="play-column"><div className={`well${quake.tick ? ` quake quake-${quake.tick % 2 ? 'a' : 'b'}` : ''}`} style={{ '--quake': quake.power } as React.CSSProperties} role="grid" aria-label="Игровое поле" onPointerDown={swipeStart} onPointerMove={swipeMove} onPointerUp={swipeEnd} onPointerCancel={() => { swipeRef.current = null; }} onContextMenu={(event) => event.preventDefault()}>{visibleBoard.flatMap((row, y) => row.map((cell, x) => <span key={`${x}-${y}`} className={`cell ${clearing.has(`${x}:${y}`) ? 'clearing' : ''}`} style={cell === null ? undefined : { '--cell': PALETTE[cell] } as React.CSSProperties} />))}{quake.tick > 0 && <span key={quake.tick} className={`board-flash power-${quake.power}`} aria-hidden="true" />}{flash && <div key={flash.id} className={`score-flash tone-${flash.tone}`}>{flash.text}</div>}{started && !running && !gameOver && <div className="pause-screen"><b>ПАУЗА</b><span>P / З — продолжить</span><button onClick={togglePause}>ПРОДОЛЖИТЬ</button></div>}{gameOver && <div className="game-over"><b>ИГРА ОКОНЧЕНА</b><button onClick={restart}>ЕЩЁ РАЗ</button></div>}</div><div className="touch" aria-label="Сенсорное управление"><button onClick={() => move(-1)} aria-label="Влево">←<small>ВЛЕВО</small></button><button onClick={cycle} aria-label="Сменить цвета">↻<small>ЦВЕТА</small></button><button onClick={() => move(1)} aria-label="Вправо">→<small>ВПРАВО</small></button><button className="soft-drop" onClick={drop} aria-label="Опустить на одну клетку">↓<small>ШАГ</small></button><button className="hard-drop" onClick={hardDrop} aria-label="Бросить до конца">⇊<small>БРОСИТЬ</small></button></div><span className="swipe-hint">ТАП: ЦВЕТА · ТАЩИ: ← → ПО КЛЕТКАМ · ↓ ВНИЗ</span></div>
      <aside className="panel controls"><p className="eyebrow">{piece.horizontal ? 'ГОРИЗОНТАЛЬНЫЙ БЛОК' : 'КОЛОННА'}</p><div className={`preview ${piece.horizontal ? 'horizontal' : ''}`}>{piece.colors.map((color, index) => <i key={index} style={{ '--cell': PALETTE[color] } as React.CSSProperties} />)}</div><p className="message" aria-live="polite">{message}</p>{!running && !gameOver ? <button onClick={requestRestart}>НОВАЯ ИГРА</button> : <button onClick={togglePause}>{running ? 'ПАУЗА' : 'ПРОДОЛЖИТЬ'}</button>}<button className="music" onClick={toggleMusic}>{musicOn ? '♫ КАЛИНКА: ВКЛ' : '♫ КАЛИНКА: ВЫКЛ'}</button><button className="music" onClick={toggleSounds}>{soundsOn ? '◉ ЗВУКИ: ВКЛ' : '○ ЗВУКИ: ВЫКЛ'}</button>{adminAllowed && <button className="music admin-open" onClick={() => setAdminOpen(true)}>⚙ НАСТРОЙКА ЗВУКОВ</button>}</aside>
    </div>
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
        <span>ВИД ФИШЕК</span>
        {BLOCK_STYLES.map(([id, title]) =>
          <button key={id} type="button" className={blockStyle === id ? 'on' : ''} onClick={() => chooseBlocks(id)}>{title}</button>)}
      </div>
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
                <label className="admin-volume"><span>ГРОМК</span><input type="range" min={0} max={300} step={5} value={Math.round(tweak.gain * 100)} onChange={event => updateTweak(file, { gain: Number(event.target.value) / 100 })} /><b>{Math.round(tweak.gain * 100)}%</b></label>
                {([['low', 'НИЗ'], ['mid', 'СЕРЕД'], ['high', 'ВЕРХ']] as const).map(([band, title]) =>
                  <label key={band} className="admin-volume"><span>{title}</span><input type="range" min={-12} max={12} step={1} value={tweak[band]} onChange={event => updateTweak(file, { [band]: Number(event.target.value) })} /><b>{tweak[band] > 0 ? '+' : ''}{tweak[band]}</b></label>)}
                <button type="button" className="admin-hide" onClick={() => toggleHidden(file)}>{off ? 'ВЕРНУТЬ' : 'СКРЫТЬ'}</button>
                {file.startsWith(ADDED_PREFIX) && <button type="button" className="admin-hide" onClick={() => removeAdded(file)}>УДАЛИТЬ</button>}
              </div>;
            })}
          </div>)}
      </div>}
      <footer><button type="button" onClick={resetSounds}>СБРОСИТЬ ВСЁ</button><button type="button" onClick={copySounds}>СКОПИРОВАТЬ</button><small>{adminNote || 'Настройки хранятся только в этом браузере'}</small></footer>
    </div></div>}
    <div className="keyboard"><span>← → движение</span><span>↑ {swapKeys ? 'бросить' : 'сменить цвета'}</span><span>↓ быстрее</span><span>ПРОБЕЛ {swapKeys ? 'сменить цвета' : 'бросить'}</span><button type="button" className="swap-keys" onClick={() => chooseScheme(!swapKeys)} title="Поменять местами ↑ и ПРОБЕЛ">⇄ ПОМЕНЯТЬ</button></div>
  </section></main>;
}
