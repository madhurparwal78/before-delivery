import { isValidBoardString } from '../shared/board.js';
import type { Level } from '../shared/puzzles.js';
import { newStartBoard } from '../shared/moves.js';

// The origin the request came from: its Origin header, else its scheme and
// Host. Used for links in the confirmation and reset messages.
export function originOf(headers: Record<string, unknown>): string {
  const origin = headers['origin'];
  if (typeof origin === 'string' && origin.length > 0) return origin;
  const host = headers['host'];
  const proto = headers['x-forwarded-proto'];
  const scheme = typeof proto === 'string' && proto.length > 0 ? proto : 'http';
  if (typeof host === 'string' && host.length > 0) return `${scheme}://${host}`;
  return 'http://localhost:4173';
}

export interface SeedInput {
  playerId: string;
  puzzleId: string;
  mode: 'solo' | 'daily';
  date: string | null;
  entries: Array<{ cell: string; digit: number }>;
  notes: Array<{ cell: string; digits: number[] }>;
  mistakes: number;
  hints: number;
  elapsedMs: number;
  secondChanceUsed: boolean;
}

export class SeedError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}

export function encodeStart(start: ReturnType<typeof newStartBoard>): { entries: string; notes: string } {
  return { entries: start.entries.join(''), notes: JSON.stringify(start.notes) };
}

export function decodeStart(entries: string, notes: string): ReturnType<typeof newStartBoard> {
  const start = newStartBoard(entries);
  const parsed = JSON.parse(notes) as number[][];
  start.notes = parsed.map((n) => [...n]);
  return start;
}

export function levelOfPuzzle(level: Level): Level {
  return level;
}

export function assertBoard(value: string): void {
  if (!isValidBoardString(value)) throw new Error('BAD_BOARD');
}
