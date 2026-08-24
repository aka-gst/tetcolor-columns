'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';

const WIDTH = 7;
const HEIGHT = 16;
const PALETTE = ['#ed4b5d', '#f4c542', '#2bb9a6', '#5b82ff', '#b267d4'];
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

function resolve(board: Board) {
  let next = board;
  let points = 0;
  let cascade = 0;
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]];
  while (true) {
    const matched = new Set<string>();
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      const color = next[y][x];
      if (color === null) continue;
      for (const [dx, dy] of directions) {
        const px = x - dx; const py = y - dy;
        if (px >= 0 && px < WIDTH && py >= 0 && py < HEIGHT && next[py][px] === color) continue;
        const run: string[] = [];
        for (let cx = x, cy = y; cx >= 0 && cx < WIDTH && cy >= 0 && cy < HEIGHT && next[cy][cx] === color; cx += dx, cy += dy) run.push(`${cx}:${cy}`);
        if (run.length >= 3) run.forEach((cell) => matched.add(cell));
      }
    }
    if (!matched.size) return { board: next, points, cascade };
    cascade += 1;
    points += matched.size * matched.size * 2 ** (cascade - 1);
    next = collapse(next.map((row, y) => row.map((cell, x) => matched.has(`${x}:${y}`) ? null : cell)));
  }
}

export default function Home() {
  const [board, setBoard] = useState<Board>(emptyBoard);
  const [piece, setPiece] = useState<Piece>(newPiece);
  const [score, setScore] = useState(0);
  const [pieces, setPieces] = useState(0);
  const [running, setRunning] = useState(false);
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState('Нажми «Старт», чтобы начать.');
  const [localBest, setLocalBest] = useState(0);
  const level = Math.floor(pieces / 20) + 1;

  useEffect(() => setLocalBest(Number(window.localStorage.getItem('tetcolor-columns-best') || 0)), []);

  const restart = useCallback(() => {
    setBoard(emptyBoard()); setPiece(newPiece()); setScore(0); setPieces(0); setGameOver(false); setRunning(true);
    setMessage('Собирай три одинаковых цвета в линию.');
  }, []);

  const drop = useCallback(() => {
    if (!running || gameOver) return;
    setPiece((active) => {
      if (canPlace(board, active, active.x, active.y + 1)) return { ...active, y: active.y + 1 };
      if (active.y < 0) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); return active; }
      const placed = board.map((row) => [...row]);
      active.colors.forEach((color, index) => { const y = active.y + index; if (y >= 0) placed[y][active.x] = color; });
      const result = resolve(placed);
      setBoard(result.board);
      if (result.points) { setScore((value) => value + result.points); setMessage(result.cascade > 1 ? `Каскад ×${result.cascade}!` : `Линия уничтожена: +${result.points}`); }
      setPieces((value) => value + 1);
      const next = newPiece();
      if (!canPlace(result.board, next)) { setRunning(false); setGameOver(true); setMessage('Поле переполнено. Попробуй ещё раз.'); }
      return next;
    });
  }, [board, gameOver, running]);

  const move = useCallback((direction: number) => {
    if (running && !gameOver) setPiece((active) => canPlace(board, active, active.x + direction) ? { ...active, x: active.x + direction } : active);
  }, [board, gameOver, running]);
  const cycle = useCallback(() => { if (running && !gameOver) setPiece((active) => ({ ...active, colors: [active.colors[2], active.colors[0], active.colors[1]] })); }, [gameOver, running]);
  const hardDrop = useCallback(() => {
    if (!running || gameOver) return;
    setPiece((active) => { let y = active.y; while (canPlace(board, active, active.x, y + 1)) y += 1; return { ...active, y }; });
    window.setTimeout(drop, 0);
  }, [board, drop, gameOver, running]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (['ArrowLeft', 'ArrowRight', 'ArrowDown', 'ArrowUp', ' '].includes(event.key)) event.preventDefault();
      if (event.key === 'ArrowLeft') move(-1); if (event.key === 'ArrowRight') move(1);
      if (event.key === 'ArrowDown') drop(); if (event.key === 'ArrowUp') cycle(); if (event.key === ' ') hardDrop();
      if (event.key.toLowerCase() === 'p') setRunning((value) => !value);
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [cycle, drop, hardDrop, move]);
  useEffect(() => { if (!running || gameOver) return; const id = window.setInterval(drop, Math.max(180, 700 - (level - 1) * 55)); return () => window.clearInterval(id); }, [drop, gameOver, level, running]);
  useEffect(() => { if (gameOver && score > localBest) { window.localStorage.setItem('tetcolor-columns-best', String(score)); setLocalBest(score); } }, [gameOver, localBest, score]);

  const visibleBoard = useMemo(() => board.map((row, y) => row.map((cell, x) => {
    const index = piece.colors.findIndex((_, part) => piece.x === x && piece.y + part === y);
    return index >= 0 ? piece.colors[index] : cell;
  })), [board, piece]);

  return <main><section className="cabinet" aria-label="Игра Tetcolor Columns">
    <header className="topline"><span>ТЕТЦВЕТ</span><span>VGA / 1991 → WEB</span></header>
    <div className="game-shell">
      <aside className="panel stats"><p className="eyebrow">СЧЁТ</p><strong>{score.toString().padStart(6, '0')}</strong><p className="eyebrow">УРОВЕНЬ</p><strong>{level.toString().padStart(2, '0')}</strong><p className="eyebrow">ЛУЧШИЙ НА ЭТОМ УСТРОЙСТВЕ</p><strong>{localBest.toString().padStart(6, '0')}</strong></aside>
      <div className="well" role="grid" aria-label="Игровое поле">{visibleBoard.flatMap((row, y) => row.map((cell, x) => <span key={`${x}-${y}`} className="cell" style={cell === null ? undefined : { backgroundColor: PALETTE[cell] }} />))}{gameOver && <div className="game-over"><b>ИГРА ОКОНЧЕНА</b><button onClick={restart}>ЕЩЁ РАЗ</button></div>}</div>
      <aside className="panel controls"><p className="eyebrow">КОЛОННА</p><div className="preview">{piece.colors.map((color, index) => <i key={index} style={{ backgroundColor: PALETTE[color] }} />)}</div><p className="message" aria-live="polite">{message}</p>{!running && !gameOver ? <button onClick={restart}>СТАРТ</button> : <button onClick={() => setRunning((value) => !value)}>{running ? 'ПАУЗА' : 'ПРОДОЛЖИТЬ'}</button>}</aside>
    </div>
    <div className="keyboard"><span>← → движение</span><span>↑ сменить порядок цветов</span><span>↓ быстрее</span><span>ПРОБЕЛ бросить</span></div>
  </section></main>;
}
