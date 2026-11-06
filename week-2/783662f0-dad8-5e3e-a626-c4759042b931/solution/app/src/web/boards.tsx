import { type ReactNode, useEffect, useLayoutEffect, useRef } from 'react';
import { PIECE_NAMES } from '../shared/domain.js';
import type { GameRecord, Position } from '../shared/types.js';
import { pieceCapture, pieceSlide, reducedMotion } from './motion.js';
import { GridRows, useGrid } from './ui.js';

/* Board rendering. Legality is decided only on the server; these helpers
   replay the moves the server has already accepted, so that the viewer can
   show the position after each one. */

const FILES = 'abcdefgh';

const squareName = (index: number): string =>
  `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;

const squareIndex = (name: string): number =>
  (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);

const START_SQUARES = (): string[] =>
  [
    ...'rnbqkbnr',
    ...'pppppppp',
    ...'........',
    ...'........',
    ...'........',
    ...'........',
    ...'PPPPPPPP',
    ...'RNBQKBNR',
  ].map((piece) => piece);

function squaresFromFen(fen: string): string[] {
  const squares: string[] = [];
  for (const row of fen.split(' ')[0].split('/')) {
    for (const char of row) {
      if (/\d/.test(char)) for (let i = 0; i < Number(char); i += 1) squares.push('.');
      else squares.push(char);
    }
  }
  return squares;
}

const isWhite = (piece: string): boolean => piece !== '.' && piece === piece.toUpperCase();

/** Applies one move the server has already accepted, with no legality check. */
function applyRecordedMove(squares: readonly string[], move: string): string[] {
  const next = [...squares];
  const from = squareIndex(move.slice(0, 2));
  const to = squareIndex(move.slice(2, 4));
  const promotion = move.slice(4, 5);
  const piece = next[from];
  const kind = piece.toLowerCase();

  next[from] = '.';
  next[to] =
    promotion === '' ? piece : isWhite(piece) ? promotion.toUpperCase() : promotion.toLowerCase();

  // A pawn moving diagonally onto an empty square took en passant.
  if (kind === 'p' && from % 8 !== to % 8 && squares[to] === '.') {
    next[isWhite(piece) ? to + 8 : to - 8] = '.';
  }
  // The king moving two files carries its rook across.
  if (kind === 'k' && Math.abs((from % 8) - (to % 8)) === 2) {
    const rank = Math.floor(to / 8) * 8;
    if (to % 8 === 6) {
      next[rank + 5] = next[rank + 7];
      next[rank + 7] = '.';
    } else {
      next[rank + 3] = next[rank + 0];
      next[rank + 0] = '.';
    }
  }
  return next;
}

function squaresAfter(moves: readonly string[], count: number): string[] {
  let squares = START_SQUARES();
  for (let i = 0; i < count && i < moves.length; i += 1) {
    squares = applyRecordedMove(squares, moves[i]);
  }
  return squares;
}

function fourRowsAfter(moves: readonly string[], count: number): string[] {
  const rows = Array.from({ length: 6 }, () => '.......'.split(''));
  for (let i = 0; i < count && i < moves.length; i += 1) {
    const column = Number(moves[i]) - 1;
    const disc = i % 2 === 0 ? 'I' : 'G';
    for (let row = 5; row >= 0; row -= 1) {
      if (rows[row][column] === '.') {
        rows[row][column] = disc;
        break;
      }
    }
  }
  return rows.map((row) => row.join(''));
}

export function replayPositionAt(game: GameRecord, at: number): Position {
  if (game.game === 'chess') {
    return { fen: `${fenOf(squaresAfter(game.moves, at))} w - - 0 1` };
  }
  if (game.game === 'four') return { rows: fourRowsAfter(game.moves, at) };
  return { trick: [], led_suit: null, tricks_won: [] };
}

function fenOf(squares: readonly string[]): string {
  const rows: string[] = [];
  for (let rank = 0; rank < 8; rank += 1) {
    let row = '';
    let gap = 0;
    for (let file = 0; file < 8; file += 1) {
      const piece = squares[rank * 8 + file];
      if (piece === '.') gap += 1;
      else {
        if (gap > 0) row += String(gap);
        gap = 0;
        row += piece;
      }
    }
    if (gap > 0) row += String(gap);
    rows.push(row);
  }
  return rows.join('/');
}

const GLYPHS: Readonly<Record<string, string>> = {
  P: '\u2659',
  N: '\u2658',
  B: '\u2657',
  R: '\u2656',
  Q: '\u2655',
  K: '\u2654',
  p: '\u265F',
  n: '\u265E',
  b: '\u265D',
  r: '\u265C',
  q: '\u265B',
  k: '\u265A',
};

const squareLabel = (piece: string, square: string): string =>
  piece === '.'
    ? `${square}, empty`
    : `${square}, ${isWhite(piece) ? 'White' : 'Black'} ${PIECE_NAMES[piece.toLowerCase()]}`;

/** A read-only chess board, used by the replay viewer. */
export function ChessBoardView({ fen }: { fen: string }): ReactNode {
  const squares = squaresFromFen(fen);
  return (
    <div className="board chess" role="grid" aria-label="Chess board" aria-readonly="true">
      <GridRows columns={8}>{squares.map((piece, index) => (
        <div
          key={index}
          role="gridcell"
          aria-label={squareLabel(piece, squareName(index))}
          className={`square ${(Math.floor(index / 8) + index) % 2 === 1 ? 'dark' : ''}`}
        >
          <span aria-hidden="true">{GLYPHS[piece] ?? ''}</span>
        </div>
      ))}</GridRows>
    </div>
  );
}

export const discLabel = (disc: string): string =>
  disc === 'I' ? 'Ink disc' : disc === 'G' ? 'Gold disc' : 'empty';

export const fourCellName = (rowIndex: number, column: number): string =>
  `${'abcdefg'[column]}${6 - rowIndex}`;

/** A read-only four-in-a-row board, used by the replay viewer. */
export function FourBoardView({ rows }: { rows: readonly string[] }): ReactNode {
  return (
    <div className="board four" role="grid" aria-label="Four in a row board" aria-readonly="true">
      <GridRows columns={7}>{rows.flatMap((row, rowIndex) =>
        [...row].map((disc, column) => (
          <div
            key={`${rowIndex}-${column}`}
            role="gridcell"
            aria-label={`${fourCellName(rowIndex, column)}, ${discLabel(disc)}`}
            className="square"
          >
            {disc === '.' ? null : (
              <span className={`disc ${disc === 'I' ? 'ink' : 'gold'}`} aria-hidden="true" />
            )}
          </div>
        )),
      )}</GridRows>
    </div>
  );
}

/* The playable chess board grid. */

interface ChessBoardProps {
  readonly fen: string;
  readonly mySeat: number | null;
  readonly selected: string | null;
  readonly onSelect: (square: string | null) => void;
  readonly onMove: (from: string, to: string) => void;
  readonly focusSquare: string | null;
}

/** The square shown at a grid position: Black sees the board from h1. */
const squareAt = (x: number, y: number, black: boolean): string =>
  black ? `${FILES[7 - x]}${y + 1}` : `${FILES[x]}${8 - y}`;

const gridOf = (square: string, black: boolean): { x: number; y: number } => {
  const file = FILES.indexOf(square[0]);
  const rank = Number(square[1]);
  return black ? { x: 7 - file, y: rank - 1 } : { x: file, y: 8 - rank };
};

/**
 * Works out which pieces moved between two accepted positions: each square
 * that a piece arrived on is matched with the square a like piece left (a pawn
 * for a promotion). Squares emptied without a match held captured pieces.
 */
function movedPieces(
  before: readonly string[],
  after: readonly string[],
): { slides: { from: number; to: number }[]; captured: { at: number; piece: string }[] } {
  const left = before.flatMap((piece, index) =>
    piece !== '.' && after[index] !== piece ? [index] : [],
  );
  const arrived = after.flatMap((piece, index) =>
    piece !== '.' && before[index] !== piece ? [index] : [],
  );
  const slides: { from: number; to: number }[] = [];
  const used = new Set<number>();
  for (const to of arrived) {
    const piece = after[to];
    const from =
      left.find((index) => !used.has(index) && before[index] === piece) ??
      left.find(
        (index) =>
          !used.has(index) &&
          before[index].toLowerCase() === 'p' &&
          isWhite(before[index]) === isWhite(piece),
      );
    if (from === undefined) continue;
    used.add(from);
    slides.push({ from, to });
  }
  const captured = arrived
    .filter((to) => before[to] !== '.')
    .map((at) => ({ at, piece: before[at] }));
  for (const index of left) {
    if (!used.has(index) && after[index] === '.') captured.push({ at: index, piece: before[index] });
  }
  return { slides, captured };
}

export function ChessBoard({
  fen,
  mySeat,
  selected,
  onSelect,
  onMove,
  focusSquare,
}: ChessBoardProps): ReactNode {
  const squares = squaresFromFen(fen);
  const black = mySeat === 2;
  const grid = useGrid(8, 8, { x: 0, y: 0 });
  const host = useRef<HTMLDivElement>(null);
  const shown = useRef<readonly string[]>(squares);

  useEffect(() => {
    if (focusSquare === null) return;
    const { x, y } = gridOf(focusSquare, black);
    grid.focusCell(x, y);
    // The focus target is set by the panel, not by the cursor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSquare, black]);

  /* An accepted move slides each moved piece from its origin square to its
     target square, and a captured piece fades out where it stood. */
  useLayoutEffect(() => {
    const before = shown.current;
    shown.current = squares;
    const board = host.current;
    if (board === null || before.join('') === squares.join('')) return;
    const cell = (index: number): HTMLElement | null =>
      board.querySelector<HTMLElement>(`[data-square="${squareName(index)}"]`);
    const { slides, captured } = movedPieces(before, squares);
    for (const { from, to } of slides) {
      const origin = cell(from)?.getBoundingClientRect();
      const target = cell(to);
      const box = target?.getBoundingClientRect();
      if (origin === undefined || box === undefined) continue;
      pieceSlide(
        target?.querySelector<HTMLElement>('.piece') ?? null,
        box.left - origin.left,
        box.top - origin.top,
      );
    }
    for (const { at, piece } of captured) {
      const where = cell(at);
      if (where === null || reducedMotion()) continue;
      const ghost = document.createElement('span');
      ghost.className = 'piece ghost';
      ghost.setAttribute('aria-hidden', 'true');
      ghost.textContent = GLYPHS[piece] ?? '';
      ghost.style.opacity = '0';
      where.appendChild(ghost);
      pieceCapture(ghost)?.finished.then(
        () => ghost.remove(),
        () => ghost.remove(),
      );
    }
  }, [fen]);

  const mine = (piece: string): boolean =>
    mySeat === 1 ? isWhite(piece) : mySeat === 2 ? piece !== '.' && !isWhite(piece) : false;

  const activate = (square: string, piece: string): void => {
    if (selected === null) {
      if (mine(piece)) onSelect(square);
      return;
    }
    if (selected === square) {
      onSelect(null);
      return;
    }
    onMove(selected, square);
  };

  const pieceOn = (square: string): string => squares[squareIndex(square)] ?? '.';

  return (
    <div
      className="board chess"
      role="grid"
      aria-label="Chess board"
      ref={host}
      onKeyDown={(event) => {
        if (grid.onKeyDown(event)) {
          event.preventDefault();
          return;
        }
        const square = squareAt(grid.cursor.x, grid.cursor.y, black);
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(square, pieceOn(square));
        } else if (event.key === 'Escape' && selected !== null) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(null);
        }
      }}
    >
      <GridRows columns={8}>{Array.from({ length: 64 }, (_, index) => {
        const x = index % 8;
        const y = Math.floor(index / 8);
        const square = squareAt(x, y, black);
        const piece = pieceOn(square);
        const isCursor = grid.cursor.x === x && grid.cursor.y === y;
        const dark = (FILES.indexOf(square[0]) + Number(square[1])) % 2 === 0;
        return (
          <div
            key={square}
            role="gridcell"
            data-square={square}
            aria-label={squareLabel(piece, square)}
            aria-selected={selected === square}
            tabIndex={isCursor ? 0 : -1}
            ref={(node) => grid.register(x, y, node)}
            onFocus={() => grid.setCursor({ x, y })}
            className={[
              'square',
              dark ? 'dark' : '',
              isCursor ? 'cursor' : '',
              selected === square ? 'selected' : '',
            ]
              .filter((part) => part !== '')
              .join(' ')}
            onClick={() => {
              grid.focusCell(x, y);
              activate(square, piece);
            }}
          >
            <span className="piece" aria-hidden="true">
              {GLYPHS[piece] ?? ''}
            </span>
          </div>
        );
      })}</GridRows>
    </div>
  );
}
