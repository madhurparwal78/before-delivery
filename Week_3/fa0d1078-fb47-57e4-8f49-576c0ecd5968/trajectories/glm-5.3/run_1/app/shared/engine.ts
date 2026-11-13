import { type BoardState, cellIndexFromName, cellName, cloneBoard, peersOf } from './board.js';
import type { ParsedMove, StartBoard } from './moves.js';

// The engine is the one place that decides the move rules, the hint rule and
// the move-log replay. The client's board and the server's replay both apply
// this code, so their answers cannot drift.

export type GuardReason = 'given' | 'hinted' | 'correct';

export interface Step {
  before: BoardState;
  after: BoardState;
}

export interface EngineState {
  board: BoardState;
  solution: string;
  puzzle: string;
  givens: boolean[];
  mistakes: number;
  hints: number;
  hintLimit: number;
  mistakeLimit: number;
  secondChanceUsed: boolean;
  undoStack: Step[];
  redoStack: Step[];
  // The board as it was before the enter that reached the mistake limit; the
  // second chance reverts exactly that enter and the notes it removed.
  fatalBefore: BoardState | null;
}

export function newEngine(puzzle: string, solution: string, start: StartBoard, mistakeLimit: number, hintLimit: number): EngineState {
  const givens = puzzle.split('').map((ch: string) => ch !== '0');
  return {
    board: {
      values: [...start.entries],
      wrong: new Array<boolean>(81).fill(false),
      hinted: new Array<boolean>(81).fill(false),
      notes: start.notes.map((n) => [...n]),
    },
    solution,
    puzzle,
    givens,
    mistakes: start.mistakes,
    hints: start.hints,
    hintLimit,
    mistakeLimit,
    secondChanceUsed: start.secondChanceUsed,
    undoStack: [],
    redoStack: [],
    fatalBefore: null,
  };
}

export function solutionDigitAt(engine: EngineState, cell: number): number {
  return Number(engine.solution[cell]);
}

export function isLockedCell(engine: EngineState, cell: number): boolean {
  const b = engine.board;
  return b.values[cell] !== 0 && !b.wrong[cell];
}

export function boardSolved(engine: EngineState): boolean {
  for (let i = 0; i < 81; i++) {
    if (engine.board.values[i] !== Number(engine.solution[i])) return false;
  }
  return true;
}

// The number of correct non-given cells (hinted cells included). This is the
// hem thread's stitch count and the duel progress count.
export function correctNonGivenCount(engine: EngineState): number {
  let n = 0;
  for (let i = 0; i < 81; i++) {
    if (!engine.givens[i] && engine.board.values[i] === Number(engine.solution[i])) n++;
  }
  return n;
}

// --------------------------------------------------------------------- moves

export type EnterOutcome =
  | { kind: 'none' }
  | { kind: 'guard'; reason: GuardReason }
  | { kind: 'entered'; correct: boolean };

export function applyEnter(engine: EngineState, cell: number, digit: number): EnterOutcome {
  const b = engine.board;
  if (engine.givens[cell]) return { kind: 'guard', reason: 'given' };
  if (b.hinted[cell]) return { kind: 'guard', reason: 'hinted' };
  if (b.values[cell] !== 0 && !b.wrong[cell]) return { kind: 'guard', reason: 'correct' };
  if (b.values[cell] === digit) return { kind: 'none' };

  const before = cloneBoard(b);
  b.notes[cell] = [];
  for (const p of peersOf(cell)) {
    const i = b.notes[p].indexOf(digit);
    if (i >= 0) b.notes[p].splice(i, 1);
  }
  const correct = digit === solutionDigitAt(engine, cell);
  b.values[cell] = digit;
  b.wrong[cell] = !correct;
  if (!correct) engine.mistakes += 1;
  pushStep(engine, before);
  if (engine.mistakes === engine.mistakeLimit) engine.fatalBefore = before;
  return { kind: 'entered', correct };
}

export type NoteOutcome =
  | { kind: 'none' }
  | { kind: 'guard'; reason: GuardReason }
  | { kind: 'toggled'; added: boolean };

export function applyNote(engine: EngineState, cell: number, digit: number): NoteOutcome {
  const b = engine.board;
  if (engine.givens[cell]) return { kind: 'guard', reason: 'given' };
  if (b.hinted[cell]) return { kind: 'guard', reason: 'hinted' };
  if (b.values[cell] !== 0 && !b.wrong[cell]) return { kind: 'guard', reason: 'correct' };
  if (b.values[cell] !== 0) return { kind: 'none' };

  const before = cloneBoard(b);
  const notes = b.notes[cell];
  const i = notes.indexOf(digit);
  let added: boolean;
  if (i >= 0) {
    notes.splice(i, 1);
    added = false;
  } else {
    notes.push(digit);
    notes.sort((x: number, y: number) => x - y);
    added = true;
  }
  pushStep(engine, before);
  return { kind: 'toggled', added };
}

export type EraseOutcome =
  | { kind: 'none' }
  | { kind: 'guard'; reason: GuardReason }
  | { kind: 'erased' };

export function applyErase(engine: EngineState, cell: number): EraseOutcome {
  const b = engine.board;
  if (engine.givens[cell]) return { kind: 'guard', reason: 'given' };
  if (b.hinted[cell]) return { kind: 'guard', reason: 'hinted' };
  if (b.values[cell] !== 0 && !b.wrong[cell]) return { kind: 'guard', reason: 'correct' };
  if (b.values[cell] === 0 && b.notes[cell].length === 0) return { kind: 'none' };

  const before = cloneBoard(b);
  b.values[cell] = 0;
  b.wrong[cell] = false;
  b.notes[cell] = [];
  pushStep(engine, before);
  return { kind: 'erased' };
}

function pushStep(engine: EngineState, before: BoardState): void {
  engine.undoStack.push({ before, after: cloneBoard(engine.board) });
  engine.redoStack = [];
}

export function applyUndo(engine: EngineState): boolean {
  const step = engine.undoStack.pop();
  if (!step) return false;
  engine.board = cloneBoard(step.before);
  engine.redoStack.push(step);
  return true;
}

export function applyRedo(engine: EngineState): boolean {
  const step = engine.redoStack.pop();
  if (!step) return false;
  engine.board = cloneBoard(step.after);
  engine.undoStack.push(step);
  return true;
}

export function clearHistories(engine: EngineState): void {
  engine.undoStack = [];
  engine.redoStack = [];
}

// --------------------------------------------------------------------- hints

export interface HintChoice {
  cell: number;
  digit: number;
}

// The hint rule: among cells that are empty or hold a wrong entry, a cell's
// candidates are the digits 1 to 9 not present among the givens, hinted cells
// and correct entries in its row, column and box; wrong entries and notes are
// ignored. The hint picks the cell with the fewest candidates, ties to the
// lowest row then the lowest column. Recomputed before every hint.
export function pickHint(engine: EngineState): HintChoice | null {
  const b = engine.board;
  let best: { cell: number; digit: number; count: number } | null = null;
  for (let i = 0; i < 81; i++) {
    if (b.values[i] !== 0 && !b.wrong[i]) continue;
    const present = new Set<number>();
    for (const p of peersOf(i)) {
      if (b.values[p] !== 0 && !b.wrong[p]) present.add(b.values[p]);
    }
    let count = 0;
    let digit = 0;
    for (let d = 1; d <= 9; d++) {
      if (!present.has(d)) {
        count++;
        if (digit === 0) digit = d;
      }
    }
    if (count === 0) continue;
    if (!best || count < best.count) best = { cell: i, digit, count };
  }
  if (!best) return null;
  return { cell: best.cell, digit: solutionDigitAt(engine, best.cell) };
}

export function applyHint(engine: EngineState, choice: HintChoice | null): HintChoice | null {
  if (!choice || engine.hints >= engine.hintLimit) return null;
  const b = engine.board;
  const { cell, digit } = choice;
  b.values[cell] = digit;
  b.wrong[cell] = false;
  b.hinted[cell] = true;
  b.notes[cell] = [];
  for (const p of peersOf(cell)) {
    const i = b.notes[p].indexOf(digit);
    if (i >= 0) b.notes[p].splice(i, 1);
  }
  engine.hints += 1;
  clearHistories(engine);
  return choice;
}

// ----------------------------------------------------------------- the log

export interface ReplayConfig {
  mistakeLimit: number;
  hintLimit: number;
  moveLimit: number;
  baseElapsedMs: number; // the start board's active time
}

export interface ReplayMoveFailure {
  code:
    | 'LOG_SEQUENCE' | 'LOG_TIME' | 'GIVEN_CELL' | 'LOCKED_CELL'
    | 'HINT_MISMATCH' | 'HINT_LIMIT' | 'MISTAKE_LIMIT';
  move: number | null;
}

export interface ReplayOutcome {
  ok: boolean;
  failure?: ReplayMoveFailure;
  unsolved?: boolean;
  engine: EngineState;
}

// Replays a move log from the start board with the published per-move check
// order. Returns the first failure, or the final engine state.
export function replayLog(puzzle: string, solution: string, start: StartBoard, moves: readonly ParsedMove[], config: ReplayConfig): ReplayOutcome {
  const engine = newEngine(puzzle, solution, start, config.mistakeLimit, config.hintLimit);
  let expectedN = 1;
  let prevT = config.baseElapsedMs;
  let lost = false;

  for (const m of moves) {
    if (m.n !== expectedN) return failMove(engine, 'LOG_SEQUENCE', m.n);
    if (m.t < 0 || m.t < prevT || m.t < config.baseElapsedMs) return failMove(engine, 'LOG_TIME', m.n);

    if (lost) {
      // After the count reaches the limit, only the first second chance may
      // follow; any other move fails.
      if (m.op === 'second_chance' && !engine.secondChanceUsed) {
        applySecondChance(engine);
        lost = false;
        expectedN++;
        continue;
      }
      return failMove(engine, 'MISTAKE_LIMIT', m.n);
    }

    switch (m.op) {
      case 'enter': {
        if (engine.givens[m.cell as number]) return failMove(engine, 'GIVEN_CELL', m.n);
        if (isLockedCell(engine, m.cell as number)) return failMove(engine, 'LOCKED_CELL', m.n);
        applyEnter(engine, m.cell as number, m.digit as number);
        if (engine.mistakes >= config.mistakeLimit) lost = true;
        break;
      }
      case 'note': {
        if (engine.givens[m.cell as number]) return failMove(engine, 'GIVEN_CELL', m.n);
        if (engine.board.values[m.cell as number] !== 0) return failMove(engine, 'LOCKED_CELL', m.n);
        applyNote(engine, m.cell as number, m.digit as number);
        break;
      }
      case 'erase': {
        if (engine.givens[m.cell as number]) return failMove(engine, 'GIVEN_CELL', m.n);
        if (isLockedCell(engine, m.cell as number)) return failMove(engine, 'LOCKED_CELL', m.n);
        applyErase(engine, m.cell as number);
        break;
      }
      case 'hint': {
        const choice = pickHint(engine);
        if (!choice || choice.cell !== m.cell || choice.digit !== m.digit) {
          return failMove(engine, 'HINT_MISMATCH', m.n);
        }
        if (engine.hints >= config.hintLimit) return failMove(engine, 'HINT_LIMIT', m.n);
        applyHint(engine, choice);
        break;
      }
      case 'undo':
        applyUndo(engine);
        break;
      case 'redo':
        applyRedo(engine);
        break;
      case 'second_chance':
        if (engine.mistakes < config.mistakeLimit) return failMove(engine, 'MISTAKE_LIMIT', m.n);
        applySecondChance(engine);
        break;
      case 'pause':
      case 'resume':
        break;
    }
    expectedN++;
  }

  return { ok: true, engine };
}

function failMove(engine: EngineState, code: ReplayMoveFailure['code'], move: number): ReplayOutcome {
  return { ok: false, failure: { code, move }, engine };
}

// The one second chance per game: remove the digit of the entry that reached
// the limit, restore the notes that entry removed, set the count to the limit
// minus one and clear both histories.
export function applySecondChance(engine: EngineState): void {
  const before = engine.fatalBefore;
  engine.mistakes = engine.mistakeLimit - 1;
  engine.secondChanceUsed = true;
  if (before) engine.board = cloneBoard(before);
  engine.fatalBefore = null;
  clearHistories(engine);
}

// A client-facing move: enter/note/erase/undo/redo applied with the same rules.
export type LiveMove =
  | { op: 'enter'; cell: number; digit: number }
  | { op: 'note'; cell: number; digit: number }
  | { op: 'erase'; cell: number }
  | { op: 'undo' }
  | { op: 'redo' };

export interface LiveApplyResult {
  ok: boolean;
  solved: boolean;
  outcome: EnterOutcome | NoteOutcome | EraseOutcome | { kind: 'undone' | 'redone' | 'nothing' };
}

export function applyLiveMove(engine: EngineState, move: LiveMove): LiveApplyResult {
  let outcome: LiveApplyResult['outcome'];
  switch (move.op) {
    case 'enter':
      outcome = applyEnter(engine, move.cell, move.digit);
      break;
    case 'note':
      outcome = applyNote(engine, move.cell, move.digit);
      break;
    case 'erase':
      outcome = applyErase(engine, move.cell);
      break;
    case 'undo':
      outcome = applyUndo(engine) ? { kind: 'undone' } : { kind: 'nothing' };
      break;
    case 'redo':
      outcome = applyRedo(engine) ? { kind: 'redone' } : { kind: 'nothing' };
      break;
  }
  return { ok: true, solved: boardSolved(engine), outcome };
}

export { cellName, cellIndexFromName };
