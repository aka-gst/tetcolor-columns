'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

const WIDTH = 7;
const HEIGHT = 16;
const PALETTE = ['#ff2bd6', '#efff00', '#00ff85', '#00d9ff', '#9b5cff'];
type Cell = number | null;
type Board = Cell[][];
type Piece = { x: number; y: number; colors: number[] };

const emptyBoard = (): Board => Array.from({ length: HEIGHT }, () => Array<Cell>(WIDTH).fill(null));
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
  const musicRef = useRef<{ context: AudioContext; timer: number; step: number } | null>(null);
  const musicWantedRef = useRef(true);
  const swipeRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const level = Math.floor(pieces / 8) + 1;

  useEffect(() => setLocalBest(Number(window.localStorage.getItem('tetcolor-columns-best') || 0)), []);

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
    const context = new AudioContext();
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
  }, []);

  const restart = useCallback(() => {
    setBoard(emptyBoard()); setPiece(newPiece()); setScore(0); setPieces(0); setGameOver(false); setRunning(true); setStarted(true); setClearing(new Set()); setResolving(false);
    setMessage('Собирай три одинаковых цвета в линию.');
    if (!musicRef.current) startMusic();
  }, [startMusic]);

  const drop = useCallback(() => {
    if (!running || gameOver || resolving) return;
    setPiece((active) => {
      if (canPlace(board, active, active.x, active.y + 1)) return { ...active, y: active.y + 1 };
      if (active.y < 0) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); return active; }
      const placed = board.map((row) => [...row]);
      active.colors.forEach((color, index) => { const y = active.y + index; if (y >= 0) placed[y][active.x] = color; });
      const finishTurn = (result: ReturnType<typeof resolve>) => {
        setBoard(result.board);
        setClearing(new Set());
        setResolving(false);
        if (result.points) { setScore((value) => value + result.points); setMessage(result.cascade > 1 ? `Каскад ×${result.cascade}!` : `Линия уничтожена: +${result.points}`); }
        setPieces((value) => value + 1);
        const next = newPiece();
        if (!canPlace(result.board, next)) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); }
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
  }, [board, gameOver, resolving, running]);

  const move = useCallback((direction: number) => {
    if (running && !gameOver && !resolving) setPiece((active) => canPlace(board, active, active.x + direction) ? { ...active, x: active.x + direction } : active);
  }, [board, gameOver, resolving, running]);
  const cycle = useCallback(() => { if (running && !gameOver && !resolving) setPiece((active) => ({ ...active, colors: [active.colors[2], active.colors[0], active.colors[1]] })); }, [gameOver, resolving, running]);
  const hardDrop = useCallback(() => {
    if (!running || gameOver || resolving) return;
    setPiece((active) => { let y = active.y; while (canPlace(board, active, active.x, y + 1)) y += 1; return { ...active, y }; });
    window.setTimeout(drop, 0);
  }, [board, drop, gameOver, resolving, running]);

  const swipeStart = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    swipeRef.current = { x: event.clientX, y: event.clientY, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const swipeMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = swipeRef.current;
    if (!drag || event.pointerType !== 'touch' || !running || gameOver || resolving) return;
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
    if (event.pointerType === 'touch' && drag && !drag.moved) cycle();
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
  useEffect(() => { if (gameOver && score > localBest) { window.localStorage.setItem('tetcolor-columns-best', String(score)); setLocalBest(score); } }, [gameOver, localBest, score]);

  const visibleBoard = useMemo(() => board.map((row, y) => row.map((cell, x) => {
    const index = resolving ? -1 : piece.colors.findIndex((_, part) => piece.x === x && piece.y + part === y);
    return index >= 0 ? piece.colors[index] : cell;
  })), [board, piece, resolving]);

  return <main><section className="cabinet" aria-label="Игра Tetcolor Columns">
    <header className="topline"><span>ТЕТЦВЕТ</span><span>ACID COLUMNS · 1991 → WEB</span></header>
    <div className="game-shell">
      <aside className="panel stats"><p className="eyebrow">СЧЁТ</p><strong>{score.toString().padStart(6, '0')}</strong><p className="eyebrow">УРОВЕНЬ</p><strong>{level.toString().padStart(2, '0')}</strong><p className="eyebrow">ЛУЧШИЙ НА ЭТОМ УСТРОЙСТВЕ</p><strong>{localBest.toString().padStart(6, '0')}</strong></aside>
      <div className="play-column"><div className="well" role="grid" aria-label="Игровое поле" onPointerDown={swipeStart} onPointerMove={swipeMove} onPointerUp={swipeEnd} onPointerCancel={() => { swipeRef.current = null; }} onContextMenu={(event) => event.preventDefault()}>{visibleBoard.flatMap((row, y) => row.map((cell, x) => <span key={`${x}-${y}`} className={`cell ${clearing.has(`${x}:${y}`) ? 'clearing' : ''}`} style={cell === null ? undefined : { '--cell': PALETTE[cell] } as React.CSSProperties} />))}{started && !running && !gameOver && <div className="pause-screen"><b>ПАУЗА</b><span>P / З — продолжить</span><button onClick={togglePause}>ПРОДОЛЖИТЬ</button></div>}{gameOver && <div className="game-over"><b>ИГРА ОКОНЧЕНА</b><button onClick={restart}>ЕЩЁ РАЗ</button></div>}</div><div className="touch" aria-label="Сенсорное управление"><button onClick={() => move(-1)} aria-label="Влево">←</button><button onClick={cycle} aria-label="Сменить цвета">↻</button><button onClick={drop} aria-label="Вниз">↓</button><button onClick={hardDrop} aria-label="Бросить">⇊</button><button onClick={() => move(1)} aria-label="Вправо">→</button></div><span className="swipe-hint">ТАП: ЦВЕТА · ТАЩИ: ← → ПО КЛЕТКАМ · ↓ ВНИЗ</span></div>
      <aside className="panel controls"><p className="eyebrow">КОЛОННА</p><div className="preview">{piece.colors.map((color, index) => <i key={index} style={{ '--cell': PALETTE[color] } as React.CSSProperties} />)}</div><p className="message" aria-live="polite">{message}</p>{!running && !gameOver ? <button onClick={restart}>СТАРТ</button> : <button onClick={togglePause}>{running ? 'ПАУЗА' : 'ПРОДОЛЖИТЬ'}</button>}<button className="music" onClick={toggleMusic}>{musicOn ? '♫ КАЛИНКА: ВКЛ' : '♫ КАЛИНКА: ВЫКЛ'}</button></aside>
    </div>
    <div className="keyboard"><span>← → движение</span><span>↑ сменить порядок цветов</span><span>↓ быстрее</span><span>ПРОБЕЛ бросить</span></div>
  </section></main>;
}
