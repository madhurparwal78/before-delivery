import { cellIndexFromName } from './board.js';

// A cell is "locked" when it is a given, a hinted cell or a correct entry.
// The start board is a puzzle's givens plus optional seeded entries, which
// count as correct entries and lock, plus optional notes.

export interface StartBoard {
  entries: number[]; // digit per cell, 0 when empty (givens and seeded entries)
  seeded: boolean[]; // true where a graded route seeded an entry
  notes: number[][]; // digits ascending per cell
  mistakes: number;
  hints: number;
  elapsedMs: number;
  secondChanceUsed: boolean;
}

export function newStartBoard(puzzle: string): StartBoard {
  return {
    entries: puzzle.split('').map(Number),
    seeded: new Array<boolean>(81).fill(false),
    notes: Array.from({ length: 81 }, () => []),
    mistakes: 0,
    hints: 0,
    elapsedMs: 0,
    secondChanceUsed: false,
  };
}

export type Op =
  | 'enter' | 'note' | 'erase' | 'hint'
  | 'undo' | 'redo' | 'second_chance'
  | 'pause' | 'resume';

export interface Move {
  n: number; // 1-based index
  t: number; // active ms at the move
  op: Op;
  cell?: string;
  digit?: number;
}

export const MOVE_OPS: readonly Op[] = [
  'enter', 'note', 'erase', 'hint', 'undo', 'redo', 'second_chance', 'pause', 'resume',
];

export function isOp(value: unknown): value is Op {
  return typeof value === 'string' && MOVE_OPS.includes(value as Op);
}

export interface ParsedMove {
  n: number;
  t: number;
  op: Op;
  cell?: number; // cell index, -1 when absent
  digit?: number;
}

export class LogFormatError extends Error {}

// Parses a raw move array with the published field requirements. Throws
// LogFormatError when a move lacks a field its op needs, an op is unknown, a
// cell or digit is invalid, or the array is malformed.
export function parseMoveLog(raw: unknown): ParsedMove[] {
  if (!Array.isArray(raw)) throw new LogFormatError();
  const out: ParsedMove[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) throw new LogFormatError();
    const rec = item as Record<string, unknown>;
    const n = rec.n;
    const t = rec.t;
    const op = rec.op;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) throw new LogFormatError();
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new LogFormatError();
    if (!isOp(op)) throw new LogFormatError();
    const move: ParsedMove = { n, t, op };
    if (op === 'enter' || op === 'note' || op === 'hint') {
      if (typeof rec.cell !== 'string' || !Number.isInteger(rec.digit)) throw new LogFormatError();
      const cell = cellIndexFromName(rec.cell);
      if (cell < 0) throw new LogFormatError();
      const digit = rec.digit as number;
      if (digit < 1 || digit > 9) throw new LogFormatError();
      move.cell = cell;
      move.digit = digit;
    } else if (op === 'erase') {
      if (typeof rec.cell !== 'string') throw new LogFormatError();
      const cell = cellIndexFromName(rec.cell);
      if (cell < 0) throw new LogFormatError();
      move.cell = cell;
    }
    out.push(move);
  }
  return out;
}
