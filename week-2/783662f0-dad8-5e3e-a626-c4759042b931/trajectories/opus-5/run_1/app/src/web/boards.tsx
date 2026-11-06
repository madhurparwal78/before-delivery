import { type ReactNode, useEffect, useRef } from 'react';
import { PIECE_NAMES } from '../shared/domain.js';
import type { GameRecord, Position } from '../shared/types.js';
import { pieceCapture, pieceSlide } from './motion.js';
import { useGrid } from './ui.js';

/* Board rendering. Legality is decided only on the server; these helpers
   replay the moves the server has already accepted, so that the viewer can
   show the position after each one. */

const FILES = 'abcdefgh';

export const squareName = (index: number): string =>
  `${FILES[index % 8]}${8 - Math.floor(index / 8)}`;

export const squareIndex = (name: string): number =>
  (8 - Number(name[1])) * 8 + FILES.indexOf(name[0]);

export const START_SQUARES = (): string[] =>
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

export function squaresFromFen(fen: string): string[] {
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
export function applyRecordedMove(squares: readonly string[], move: string): string[] {
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

export function squaresAfter(moves: readonly string[], count: number): string[] {
  let squares = START_SQUARES();
  for (let i = 0; i < count && i < moves.length; i += 1) {
    squares = applyRecordedMove(squares, moves[i]);
  }
  return squares;
}

export function fourRowsAfter(moves: readonly string[], count: number): string[] {
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

export const squareLabel = (piece: string, square: string): string =>
  piece === '.'
    ? `${square}, empty`
    : `${square}, ${isWhite(piece) ? 'White' : 'Black'} ${PIECE_NAMES[piece.toLowerCase()]}`;

/** A read-only chess board, used by the replay viewer. */
export function ChessBoardView({ fen }: { fen: string }): ReactNode {
  const squares = squaresFromFen(fen);
  return (
    <div className="board chess" role="grid" aria-label="Chess board" aria-readonly="true">
      {squares.map((piece, index) => (
        <div
          key={index}
          role="gridcell"
          aria-label={squareLabel(piece, squareName(index))}
          className={`square ${(Math.floor(index / 8) + index) % 2 === 1 ? 'dark' : ''}`}
        >
          <span aria-hidden="true">{GLYPHS[piece] ?? ''}</span>
        </div>
      ))}
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
      {rows.flatMap((row, rowIndex) =>
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
      )}
    </div>
  );
}

/* The playable chess board grid. */

export interface ChessBoardProps {
  readonly fen: string;
  readonly mySeat: number | null;
  readonly selected: string | null;
  readonly onSelect: (square: string | null) => void;
  readonly onMove: (from: string, to: string) => void;
  readonly focusSquare: string | null;
  readonly lastMove: string | null;
}

export function ChessBoard({
  fen,
  mySeat,
  selected,
  onSelect,
  onMove,
  focusSquare,
  lastMove,
}: ChessBoardProps): ReactNode {
  const squares = squaresFromFen(fen);
  const grid = useGrid(8, 8, { x: 0, y: 0 });
  const host = useRef<HTMLDivElement>(null);
  const previous = useRef<string | null>(null);

  useEffect(() => {
    if (focusSquare === null) return;
    const index = squareIndex(focusSquare);
    grid.focusCell(index % 8, Math.floor(index / 8));
    // The focus target is set by the server's answer, not by the cursor itself.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSquare]);

  /* An accepted move slides the piece to its square. */
  useEffect(() => {
    if (lastMove === null || lastMove === previous.current) return;
    previous.current = lastMove;
    const to = squareIndex(lastMove.slice(2, 4));
    const from = squareIndex(lastMove.slice(0, 2));
    const node = host.current?.querySelector<HTMLElement>(`[data-square="${squareName(to)}"] span`);
    const size = node?.getBoundingClientRect().width ?? 40;
    pieceSlide(node ?? null, ((to % 8) - (from % 8)) * size, (Math.floor(to / 8) - Math.floor(from / 8)) * size);
  }, [lastMove]);

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
        const index = grid.cursor.y * 8 + grid.cursor.x;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          activate(squareName(index), squares[index]);
        } else if (event.key === 'Escape' && selected !== null) {
          event.preventDefault();
          event.stopPropagation();
          onSelect(null);
        }
      }}
    >
      {squares.map((piece, index) => {
        const x = index % 8;
        const y = Math.floor(index / 8);
        const square = squareName(index);
        const isCursor = grid.cursor.x === x && grid.cursor.y === y;
        return (
          <div
            key={index}
            role="gridcell"
            data-square={square}
            aria-label={squareLabel(piece, square)}
            aria-selected={selected === square}
            tabIndex={isCursor ? 0 : -1}
            ref={(node) => grid.register(x, y, node)}
            className={[
              'square',
              (y + index) % 2 === 1 ? 'dark' : '',
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
            <span aria-hidden="true">{GLYPHS[piece] ?? ''}</span>
          </div>
        );
      })}
    </div>
  );
}

