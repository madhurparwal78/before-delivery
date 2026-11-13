import { isCellName, isDigit, type Cell, type Digit } from './board';
import { type Game, type LoggedMove, type MoveOp } from './engine';

export type MoveLogCode =
  | 'LOG_SEQUENCE'
  | 'LOG_TIME'
  | 'GIVEN_CELL'
  | 'LOCKED_CELL'
  | 'HINT_MISMATCH'
  | 'HINT_LIMIT'
  | 'MISTAKE_LIMIT'
  | 'BOARD_UNSOLVED';

export interface MoveLogFailure {
  code: MoveLogCode;
  move: number | null;
}

const OPS: readonly MoveOp[] = [
  'enter',
  'note',
  'erase',
  'hint',
  'undo',
  'redo',
  'second_chance',
  'pause',
  'resume',
];

const NEEDS_CELL: readonly MoveOp[] = ['enter', 'note', 'erase', 'hint'];
const NEEDS_DIGIT: readonly MoveOp[] = ['enter', 'note', 'hint'];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a move log body, or reports that it is malformed. */
export function parseMoveLog(body: unknown, moveLimit: number): LoggedMove[] | null {
  if (!isRecord(body) || !Array.isArray(body.moves)) return null;
  if (body.moves.length > moveLimit) return null;
  const moves: LoggedMove[] = [];
  for (const raw of body.moves) {
    if (!isRecord(raw)) return null;
    const { n, t, op } = raw;
    if (typeof n !== 'number' || !Number.isInteger(n)) return null;
    if (typeof t !== 'number' || !Number.isFinite(t)) return null;
    if (typeof op !== 'string' || !(OPS as readonly string[]).includes(op)) return null;
    const move: LoggedMove = { n, t, op: op as MoveOp };
    if (NEEDS_CELL.includes(move.op)) {
      if (!isCellName(raw.cell)) return null;
      move.cell = raw.cell;
    }
    if (NEEDS_DIGIT.includes(move.op)) {
      if (!isDigit(raw.digit)) return null;
      move.digit = raw.digit;
    }
    moves.push(move);
  }
  return moves;
}

/** The published fields of a move, used to compare two finish logs. */
export function sameMoveLog(a: readonly LoggedMove[], b: readonly LoggedMove[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((move, index) => {
    const other = b[index];
    if (!other) return false;
    return (
      move.n === other.n &&
      move.t === other.t &&
      move.op === other.op &&
      move.cell === other.cell &&
      move.digit === other.digit
    );
  });
}

export interface ReplayResult {
  failure: MoveLogFailure | null;
  lastT: number;
}

/**
 * Applies the log to the game from its start board, in the published check
 * order. `checkSolved` adds the final BOARD_UNSOLVED step a finish needs.
 */
export function replayMoveLog(
  game: Game,
  moves: readonly LoggedMove[],
  startElapsedMs: number,
  checkSolved: boolean,
): ReplayResult {
  let previousN = 0;
  let previousT = startElapsedMs;
  let lastT = startElapsedMs;

  for (const move of moves) {
    const failure = checkMove(game, move, previousN, previousT, startElapsedMs);
    if (failure) return { failure: { code: failure, move: move.n }, lastT };
    applyMove(game, move);
    previousN = move.n;
    previousT = move.t;
    lastT = move.t;
  }

  if (checkSolved && !game.solved) {
    return { failure: { code: 'BOARD_UNSOLVED', move: null }, lastT };
  }
  return { failure: null, lastT };
}

function checkMove(
  game: Game,
  move: LoggedMove,
  previousN: number,
  previousT: number,
  startElapsedMs: number,
): MoveLogCode | null {
  if (move.n !== previousN + 1) return 'LOG_SEQUENCE';
  if (move.t < 0 || move.t < previousT || move.t < startElapsedMs) return 'LOG_TIME';

  const cell = move.cell as Cell | undefined;
  if (cell && (move.op === 'enter' || move.op === 'note' || move.op === 'erase')) {
    if (game.isGiven(cell)) return 'GIVEN_CELL';
  }
  if (cell && (move.op === 'enter' || move.op === 'erase')) {
    if (game.isHinted(cell) || game.isCorrectEntry(cell)) return 'LOCKED_CELL';
  }
  if (cell && move.op === 'note' && game.entryAt(cell) !== null) return 'LOCKED_CELL';

  if (move.op === 'hint' && cell) {
    const pick = game.pickHintCell();
    if (pick !== cell || move.digit !== game.solutionDigit(cell)) return 'HINT_MISMATCH';
    if (game.hintsLeft <= 0) return 'HINT_LIMIT';
  }

  if (game.lost) {
    if (move.op !== 'second_chance' || game.secondChanceUsed) return 'MISTAKE_LIMIT';
  } else if (move.op === 'second_chance') {
    return 'MISTAKE_LIMIT';
  }
  return null;
}

function applyMove(game: Game, move: LoggedMove): void {
  const cell = move.cell as Cell | undefined;
  const digit = move.digit as Digit | undefined;
  switch (move.op) {
    case 'enter':
      game.enter(cell as Cell, digit as Digit);
      return;
    case 'note':
      game.toggleNote(cell as Cell, digit as Digit);
      return;
    case 'erase':
      game.erase(cell as Cell);
      return;
    case 'hint':
      game.applyHint(cell as Cell, digit as Digit);
      return;
    case 'undo':
      game.undo();
      return;
    case 'redo':
      game.redo();
      return;
    case 'second_chance':
      game.secondChance();
      return;
    case 'pause':
    case 'resume':
      return;
  }
}
