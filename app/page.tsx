'use client';

declare global {
  interface Window {
    umami?: { track: (event: string, data?: Record<string, string | number>) => void };
    requestPlayerName: () => Promise<string>;
    webkitAudioContext?: typeof AudioContext;
  }
}

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const WIDTH = 7;
const HEIGHT = 16;
const createAudioContext = () => {
  const AudioEngine = window.AudioContext ?? window.webkitAudioContext;
  if (!AudioEngine) throw new Error('Web Audio is unavailable');
  return new AudioEngine();
};
const PALETTE = ['#ff2bd6', '#efff00', '#00ff85', '#00d9ff', '#9b5cff'];
type Cell = number | null;
type Board = Cell[][];
type Piece = { x: number; y: number; colors: number[] };
type Sound = 'start' | 'move' | 'cycle' | 'land' | 'clear' | 'level' | 'gameover';
type GlobalScore = { nickname: string; score: number };
type Flash = { id: number; text: string; tone: number };

const BONUS_PHRASES = ['КИСЛОТНО!', 'ВОТ ЭТО ХОД!', 'НЕОН ГОРИТ!', 'ЖАРА!', 'ТРИ В РЯД!', '90-е ЗВОНЯТ!'];
const EASTER_FILES = Array.from({ length: 15 }, (_, index) => `/sounds/eggs/egg-${index + 1}.mp3`);

const SOUND_FILES: Record<Sound, string[]> = {
  start: ['/sounds/level-1.mp3', '/sounds/clear-2.mp3'],
  move: ['/sounds/move-1.mp3', '/sounds/move-2.mp3'],
  cycle: ['/sounds/cycle-1.mp3', '/sounds/cycle-2.mp3'],
  // A softer "whoosh" instead of the old tick-tock landing sound.
  land: ['/sounds/move-2.mp3', '/sounds/cycle-1.mp3', '/sounds/cycle-2.mp3'],
  clear: ['/sounds/clear-1.mp3', '/sounds/clear-2.mp3', '/sounds/cycle-2.mp3'],
  level: ['/sounds/level-1.mp3', '/sounds/clear-1.mp3'],
  gameover: ['/sounds/gameover-1.mp3', '/sounds/gameover-2.mp3'],
};

const emptyBoard = (): Board => Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null));
const localDay = () => {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
};
const newPiece = (): Piece => ({ x: Math.floor(WIDTH / 2), y: -3, colors: Array.from({ length: 3 }, () => Math.floor(Math.random() * PALETTE.length)) });
const canPlace = (board: Board, piece: Piece, x = piece.x, y = piece.y) => piece.colors.every((_, index) => {
  const row = y + index;
  return x >= 0 && x < WIDTH && row < HEIGHT && (row < 0 || board[row][x] === null);
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
  const [piece, setPiece] = useState<Piece>({ x: Math.floor(WIDTH / 2), y: -3, colors: [0, 1, 2] });
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
  const [globalScores, setGlobalScores] = useState<GlobalScore[]>([]);
  const [flash, setFlash] = useState<Flash | null>(null);
  const musicRef = useRef<{ context: AudioContext; timer: number; step: number } | null>(null);
  const activeSoundsRef = useRef<Set<HTMLAudioElement>>(new Set());
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

  useEffect(() => {
    setLocalBest(Number(window.localStorage.getItem('tetcolor-columns-best') || 0));
    const enabled = window.localStorage.getItem('tetcolor-sounds') !== 'off';
    soundsWantedRef.current = enabled;
    setSoundsOn(enabled);
    dailyBestRef.current = Number(window.localStorage.getItem(`tetcolor-daily-best:${localDay()}`) || 0);
    void fetch('/api/leaderboard/scores?game=tetcolor&period=today&limit=3').then(response => response.json()).then(data => setGlobalScores(data.scores ?? [])).catch(() => undefined);
  }, []);

  const playSound = useCallback((sound: Sound) => {
    if (!soundsWantedRef.current) return;
    try {
      const choices = SOUND_FILES[sound];
      const audio = new Audio(choices[Math.floor(Math.random() * choices.length)]);
      audio.volume = sound === 'move' ? .3 : sound === 'cycle' ? .42 : .58;
      audio.playbackRate = .93 + Math.random() * .14;
      activeSoundsRef.current.add(audio);
      const release = () => activeSoundsRef.current.delete(audio);
      audio.addEventListener('ended', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      void audio.play().catch(release);
    } catch { /* Sound is optional on browsers that block audio playback. */ }
  }, []);

  const playEaster = useCallback((chance = .12) => {
    if (!soundsWantedRef.current || Math.random() > chance || Date.now() - lastEasterRef.current < 18000) return;
    try {
      const audio = new Audio(EASTER_FILES[Math.floor(Math.random() * EASTER_FILES.length)]);
      audio.volume = .62;
      audio.playbackRate = .96 + Math.random() * .08;
      lastEasterRef.current = Date.now();
      activeSoundsRef.current.add(audio);
      const release = () => activeSoundsRef.current.delete(audio);
      audio.addEventListener('ended', release, { once: true });
      audio.addEventListener('error', release, { once: true });
      void audio.play().catch(release);
    } catch { /* Easter eggs stay optional when audio playback is blocked. */ }
  }, []);

  const toggleSounds = useCallback(() => {
    const enabled = !soundsWantedRef.current;
    soundsWantedRef.current = enabled;
    setSoundsOn(enabled);
    window.localStorage.setItem('tetcolor-sounds', enabled ? 'on' : 'off');
    if (!enabled) {
      activeSoundsRef.current.forEach(audio => { audio.pause(); audio.currentTime = 0; });
      activeSoundsRef.current.clear();
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

  useEffect(() => () => {
    const music = musicRef.current;
    if (music) { window.clearInterval(music.timer); void music.context.close(); }
    activeSoundsRef.current.forEach(audio => audio.pause());
    activeSoundsRef.current.clear();
    if (flashTimerRef.current !== null) window.clearTimeout(flashTimerRef.current);
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

  const drop = useCallback(() => {
    if (!running || gameOver || resolving) return;
    setPiece((active) => {
      if (canPlace(board, active, active.x, active.y + 1)) return { ...active, y: active.y + 1 };
      if (active.y < 0) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); playSound('gameover'); return active; }
      if (Math.random() < .38) playSound('land');
      const placed = board.map((row) => [...row]);
      active.colors.forEach((color, index) => { const y = active.y + index; if (y >= 0) placed[y][active.x] = color; });
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
          if (Math.floor(nextValue / 8) > Math.floor(value / 8)) { playSound('level'); showFlash(`УРОВЕНЬ ${Math.floor(nextValue / 8) + 1}!`); playEaster(.4); }
          return nextValue;
        });
        const next = newPiece();
        if (!canPlace(result.board, next)) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); playSound('gameover'); }
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
          playSound('clear');
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
  }, [board, gameOver, playEaster, playSound, resolving, running, showFlash]);

  const move = useCallback((direction: number) => {
    if (running && !gameOver && !resolving) setPiece((active) => {
      if (!canPlace(board, active, active.x + direction)) return active;
      playSound('move');
      return { ...active, x: active.x + direction };
    });
  }, [board, gameOver, playSound, resolving, running]);
  const cycle = useCallback(() => { if (running && !gameOver && !resolving) { playSound('cycle'); setPiece((active) => ({ ...active, colors: [active.colors[2], active.colors[0], active.colors[1]] })); } }, [gameOver, playSound, resolving, running]);
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
    const horizontalStep = (bounds.width / WIDTH) * 0.72;
    const verticalStep = (bounds.height / HEIGHT) * 0.8;
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
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowDown') drop(); if (event.key === 'ArrowUp') cycle(); if (event.key === ' ') hardDrop();
      if ((event.code === 'KeyP' || ['p', 'з'].includes(event.key.toLowerCase())) && !event.repeat) { event.preventDefault(); togglePause(); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [cycle, drop, hardDrop, move, togglePause]);
  useEffect(() => { if (!running || gameOver) return; const id = window.setInterval(drop, Math.max(125, 620 - (level - 1) * 50)); return () => window.clearInterval(id); }, [drop, gameOver, level, running]);
  useEffect(() => {
    if (gameOver && !submittedRef.current) {
      submittedRef.current = true;
      window.umami?.track('game-finish', { game: 'tetcolor', score });
      const token = leaderboardTokenRef.current;
      const isDailyRecord = score > 0 && score > dailyBestRef.current;
      if (isDailyRecord) {
        dailyBestRef.current = score;
        window.localStorage.setItem(`tetcolor-daily-best:${localDay()}`, String(score));
      }
      if (token && isDailyRecord) void window.requestPlayerName().then(nickname => fetch('/api/leaderboard/scores', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token, nickname, score }) })).then(() => fetch('/api/leaderboard/scores?game=tetcolor&period=today&limit=3')).then(response => response.json()).then(data => setGlobalScores(data.scores ?? [])).catch(() => undefined);
    }
    if (gameOver && score > localBest) { window.localStorage.setItem('tetcolor-columns-best', String(score)); setLocalBest(score); }
  }, [gameOver, localBest, score]);

  const visibleBoard = useMemo(() => board.map((row, y) => row.map((cell, x) => {
    const index = resolving ? -1 : piece.colors.findIndex((_, part) => piece.x === x && piece.y + part === y);
    return index >= 0 ? piece.colors[index] : cell;
  })), [board, piece, resolving]);

  return <main>{!started && <div className="start-screen" role="dialog" aria-label="Начать игру"><div className="start-card"><span>TETCOLOR · 1991</span><b>TETCOLOR</b><p>Три кубика. Собирай линии. Меняй цвета тапом.</p><button type="button" onClick={restart}>СТАРТ</button></div></div>}<section className="cabinet" aria-label="Игра Tetcolor Columns">
    <header className="topline"><span>TETCOLOR</span><span>ACID COLUMNS · 1991 → WEB</span><details className="home-menu"><summary aria-label="Открыть меню">⌂</summary><a href="https://aka-gst.ru/">НА ГЛАВНУЮ</a></details></header>
    <div className="game-shell">
      <aside className="panel stats"><p className="eyebrow">СЧЁТ</p><strong>{score}</strong><p className="eyebrow">УРОВЕНЬ</p><strong>{level}</strong><p className="eyebrow">ЛУЧШИЙ НА ЭТОМ УСТРОЙСТВЕ</p><strong>{localBest}</strong><p className="eyebrow">ГЛОБАЛЬНЫЙ ТОП</p><ol className="global-scores">{globalScores.map((entry, index) => <li key={`${entry.nickname}-${index}`}><span>{entry.nickname}</span><b>{entry.score}</b></li>)}</ol></aside>
      <div className="play-column"><div className="well" role="grid" aria-label="Игровое поле" onPointerDown={swipeStart} onPointerMove={swipeMove} onPointerUp={swipeEnd} onPointerCancel={() => { swipeRef.current = null; }} onContextMenu={(event) => event.preventDefault()}>{visibleBoard.flatMap((row, y) => row.map((cell, x) => <span key={`${x}-${y}`} className={`cell ${clearing.has(`${x}:${y}`) ? 'clearing' : ''}`} style={cell === null ? undefined : { '--cell': PALETTE[cell] } as React.CSSProperties} />))}{flash && <div key={flash.id} className={`score-flash tone-${flash.tone}`}>{flash.text}</div>}{started && !running && !gameOver && <div className="pause-screen"><b>ПАУЗА</b><span>P / З — продолжить</span><button onClick={togglePause}>ПРОДОЛЖИТЬ</button></div>}{gameOver && <div className="game-over"><b>ИГРА ОКОНЧЕНА</b><button onClick={restart}>ЕЩЁ РАЗ</button></div>}</div><div className="touch" aria-label="Сенсорное управление"><button onClick={() => move(-1)} aria-label="Влево">←</button><button onClick={cycle} aria-label="Сменить цвета">↻</button><button onClick={drop} aria-label="Вниз">↓</button><button onClick={hardDrop} aria-label="Бросить">⇊</button><button onClick={() => move(1)} aria-label="Вправо">→</button></div><span className="swipe-hint">ТАП: ЦВЕТА · ТАЩИ: ← → ПО КЛЕТКАМ · ↓ ВНИЗ</span></div>
      <aside className="panel controls"><p className="eyebrow">КОЛОННА</p><div className="preview">{piece.colors.map((color, index) => <i key={index} style={{ '--cell': PALETTE[color] } as React.CSSProperties} />)}</div><p className="message" aria-live="polite">{message}</p>{!running && !gameOver ? <button onClick={restart}>СТАРТ</button> : <button onClick={togglePause}>{running ? 'ПАУЗА' : 'ПРОДОЛЖИТЬ'}</button>}<button className="music" onClick={toggleMusic}>{musicOn ? '♫ КАЛИНКА: ВКЛ' : '♫ КАЛИНКА: ВЫКЛ'}</button><button className="music" onClick={toggleSounds}>{soundsOn ? '◉ ЗВУКИ: ВКЛ' : '○ ЗВУКИ: ВЫКЛ'}</button></aside>
    </div>
    <div className="keyboard"><span>← → движение</span><span>↑ сменить порядок цветов</span><span>↓ быстрее</span><span>ПРОБЕЛ бросить</span></div>
  </section></main>;
}
