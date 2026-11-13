import { CELL_COUNT, PEERS, cellIndex, cellName, type CellName, type Digit } from "./board";

export interface Stamp {
  n: number;
  t: number;
}

/** One move of the log: `n` is its 1-based index, `t` the active time in ms when it was made. */
export type Move = Stamp &
  (
    | { op: "enter" | "note" | "hint"; cell: CellName; digit: Digit }
    | { op: "erase"; cell: CellName }
    | { op: "undo" | "redo" | "second_chance" | "pause" | "resume" }
  );

export interface Rules {
  mistakeLimit: number;
  hintLimit: number;
}

export interface StartBoard {
  entries: { cell: CellName; digit: Digit }[];
  notes: { cell: CellName; digits: Digit[] }[];
  mistakes: number;
  hints: number;
  elapsed_ms: number;
  second_chance_used: boolean;
}

type MoveCode =
  | "LOG_SEQUENCE"
  | "LOG_TIME"
  | "GIVEN_CELL"
  | "LOCKED_CELL"
  | "HINT_MISMATCH"
  | "HINT_LIMIT"
  | "MISTAKE_LIMIT";

/** Why a cell refuses a change: it is a given, a hinted cell, a correct entry, or (notes only) a wrong entry. */
export type Guard = "given" | "hinted" | "correct" | "wrong";

interface MoveFailure {
  code: MoveCode;
  guard?: Guard;
}

interface CellContent {
  value: number;
  notes: number;
}

interface CellChange {
  index: number;
  before: CellContent;
  after: CellContent;
}

/** One enter, note or erase: the cell it touched first, then every peer whose notes it changed. */
interface Edit {
  changes: readonly CellChange[];
}

type Standing = { lost: false } | { lost: true; edit: Edit; cell: number };

export interface BoardState {
  readonly puzzle: string;
  readonly solution: string;
  readonly values: readonly number[];
  readonly notes: readonly number[];
  readonly hinted: readonly boolean[];
  readonly mistakes: number;
  readonly hints: number;
  readonly secondChanceUsed: boolean;
  /** Lost carries the edit of the entry that reached the mistake limit, which the second chance takes back. */
  readonly standing: Standing;
  readonly undoStack: readonly Edit[];
  readonly redoStack: readonly Edit[];
  readonly lastN: number;
  readonly lastT: number;
}

export type MoveEffect =
  | { kind: "enter"; cell: CellName; digit: Digit; correct: boolean }
  | { kind: "note"; cell: CellName; digit: Digit; added: boolean }
  | { kind: "erase"; cell: CellName }
  | { kind: "hint"; cell: CellName; digit: Digit }
  | { kind: "undo" | "redo" | "second_chance" | "pause" | "resume" };

/**
 * A press that changes nothing is not a move and is not written to the log (`logged: false`); `blocked`
 * says whether it was an undo or a redo with nothing to take back or re-apply.
 */
type Applied =
  | { state: BoardState; logged: true; effect: MoveEffect }
  | { state: BoardState; logged: false; blocked: "undo" | "redo" | null };

type MoveResult = { refused: MoveFailure } | Applied;

interface Replayed {
  /** The board after every move that was accepted. */
  state: BoardState;
  /** The first move a check refused, with its `n`; null when the whole log was accepted. */
  failure: { failure: MoveFailure; move: number } | null;
}

export function initialBoard(puzzle: string, solution: string, start: StartBoard): BoardState {
  const values = [...puzzle].map(Number);
  const notes = new Array<number>(CELL_COUNT).fill(0);
  for (const entry of start.entries) values[cellIndex(entry.cell)] = entry.digit;
  for (const seeded of start.notes) {
    notes[cellIndex(seeded.cell)] = seeded.digits.reduce((mask, digit) => mask | (1 << digit), 0);
  }
  return {
    puzzle,
    solution,
    values,
    notes,
    hinted: new Array<boolean>(CELL_COUNT).fill(false),
    mistakes: start.mistakes,
    hints: start.hints,
    secondChanceUsed: start.second_chance_used,
    standing: { lost: false },
    undoStack: [],
    redoStack: [],
    lastN: 0,
    lastT: start.elapsed_ms,
  };
}

const isGiven = (state: BoardState, index: number): boolean => state.puzzle[index] !== "0";

const solutionDigit = (state: BoardState, index: number): Digit => Number(state.solution[index]) as Digit;

export type CellKind = "given" | "hinted" | "correct" | "wrong" | "empty";

export function cellKind(state: BoardState, index: number): CellKind {
  if (isGiven(state, index)) return "given";
  if (state.hinted[index]) return "hinted";
  const value = state.values[index] ?? 0;
  if (value === 0) return "empty";
  return value === solutionDigit(state, index) ? "correct" : "wrong";
}

/** Correct entries and hinted cells, givens excluded: the stitches of the hem thread. */
export function stitchCount(state: BoardState): number {
  let count = 0;
  for (let index = 0; index < CELL_COUNT; index++) {
    const kind = cellKind(state, index);
    if (kind === "correct" || kind === "hinted") count++;
  }
  return count;
}

export function isSolved(state: BoardState): boolean {
  return state.values.every((value, index) => value === solutionDigit(state, index));
}

/** Digits already fixed (given, hinted or correct) among a cell's peers, as a bitmask. */
function fixedPeerDigits(state: BoardState, index: number): number {
  let mask = 0;
  for (const peer of PEERS[index] ?? []) {
    const kind = cellKind(state, peer);
    if (kind === "given" || kind === "hinted" || kind === "correct") mask |= 1 << (state.values[peer] ?? 0);
  }
  return mask;
}

function candidateCount(state: BoardState, index: number): number {
  const fixed = fixedPeerDigits(state, index);
  let count = 0;
  for (let digit = 1; digit <= 9; digit++) if (!(fixed & (1 << digit))) count++;
  return count;
}

/** The cell with the fewest candidates among empty and wrong cells, ties to the lowest row then column. */
export function chooseHint(state: BoardState): { cell: CellName; digit: Digit } | null {
  let best = -1;
  let fewest = 10;
  for (let index = 0; index < CELL_COUNT; index++) {
    const kind = cellKind(state, index);
    if (kind !== "empty" && kind !== "wrong") continue;
    const count = candidateCount(state, index);
    if (count < fewest) {
      fewest = count;
      best = index;
    }
  }
  return best < 0 ? null : { cell: cellName(best), digit: solutionDigit(state, best) };
}

function refuse(code: MoveCode, guard?: Guard): MoveResult {
  return { refused: guard ? { code, guard } : { code } };
}

function applyChanges(state: BoardState, changes: readonly CellChange[], side: "before" | "after"): BoardState {
  const values = [...state.values];
  const notes = [...state.notes];
  for (const change of changes) {
    values[change.index] = change[side].value;
    notes[change.index] = change[side].notes;
  }
  return { ...state, values, notes };
}

/** The changes of putting `digit` in a cell: the cell itself, then the digit struck from its peers' notes. */
function placeChanges(state: BoardState, index: number, digit: number): CellChange[] {
  const before = { value: state.values[index] ?? 0, notes: state.notes[index] ?? 0 };
  const changes: CellChange[] = [{ index, before, after: { value: digit, notes: 0 } }];
  for (const peer of PEERS[index] ?? []) {
    const peerNotes = state.notes[peer] ?? 0;
    if (peerNotes & (1 << digit)) {
      const content = { value: state.values[peer] ?? 0, notes: peerNotes };
      changes.push({ index: peer, before: content, after: { value: content.value, notes: peerNotes & ~(1 << digit) } });
    }
  }
  return changes;
}

function recorded(state: BoardState, changes: CellChange[], effect: MoveEffect): Applied {
  const edit = { changes };
  return {
    state: { ...applyChanges(state, changes, "after"), undoStack: [...state.undoStack, edit], redoStack: [] },
    logged: true,
    effect,
  };
}

const nothing = (state: BoardState): Applied => ({ state, logged: false, blocked: null });

/** Why a cell of this kind refuses an enter, a note or an erase, if it does. */
export function guardFor(kind: CellKind, op: "enter" | "note" | "erase"): Guard | null {
  if (kind === "given" || kind === "hinted" || kind === "correct") return kind;
  return kind === "wrong" && op === "note" ? "wrong" : null;
}

function enterDigit(state: BoardState, index: number, digit: Digit, rules: Rules): Applied {
  if (state.values[index] === digit) return nothing(state);
  const correct = digit === solutionDigit(state, index);
  const changes = placeChanges(state, index, digit);
  const result = recorded(state, changes, { kind: "enter", cell: cellName(index), digit, correct });
  if (correct) return result;
  const mistakes = state.mistakes + 1;
  const standing: Standing = mistakes >= rules.mistakeLimit ? { lost: true, edit: { changes }, cell: index } : { lost: false };
  return { ...result, state: { ...result.state, mistakes, standing } };
}

function toggleNote(state: BoardState, index: number, digit: Digit): Applied {
  const before = { value: 0, notes: state.notes[index] ?? 0 };
  const after = { value: 0, notes: before.notes ^ (1 << digit) };
  const added = Boolean(after.notes & (1 << digit));
  return recorded(state, [{ index, before, after }], { kind: "note", cell: cellName(index), digit, added });
}

function eraseCell(state: BoardState, index: number): Applied {
  const before = { value: state.values[index] ?? 0, notes: state.notes[index] ?? 0 };
  if (before.value === 0 && before.notes === 0) return nothing(state);
  return recorded(state, [{ index, before, after: { value: 0, notes: 0 } }], { kind: "erase", cell: cellName(index) });
}

function hintCell(state: BoardState, index: number, digit: Digit): Applied {
  const hinted = [...state.hinted];
  hinted[index] = true;
  const applied = applyChanges(state, placeChanges(state, index, digit), "after");
  return {
    state: { ...applied, hinted, hints: state.hints + 1, undoStack: [], redoStack: [] },
    logged: true,
    effect: { kind: "hint", cell: cellName(index), digit },
  };
}

/** Takes back the entry that reached the limit: its digit goes, the notes it struck come back. */
function secondChance(state: BoardState, edit: Edit, cell: number, rules: Rules): Applied {
  const restored = applyChanges(state, edit.changes, "before");
  const values = [...restored.values];
  values[cell] = 0;
  return {
    state: {
      ...restored,
      values,
      mistakes: rules.mistakeLimit - 1,
      secondChanceUsed: true,
      standing: { lost: false },
      undoStack: [],
      redoStack: [],
    },
    logged: true,
    effect: { kind: "second_chance" },
  };
}

function undo(state: BoardState): Applied {
  const edit = state.undoStack[state.undoStack.length - 1];
  if (!edit) return { state, logged: false, blocked: "undo" };
  return {
    state: { ...applyChanges(state, edit.changes, "before"), undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, edit] },
    logged: true,
    effect: { kind: "undo" },
  };
}

function redo(state: BoardState): Applied {
  const edit = state.redoStack[state.redoStack.length - 1];
  if (!edit) return { state, logged: false, blocked: "redo" };
  return {
    state: { ...applyChanges(state, edit.changes, "after"), redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, edit] },
    logged: true,
    effect: { kind: "redo" },
  };
}

/**
 * The one place the move rules and their check order live. The server replays a log through it and the
 * client applies each move through it before writing the move to the log.
 */
export function applyMove(state: BoardState, move: Move, rules: Rules): MoveResult {
  if (move.n !== state.lastN + 1) return refuse("LOG_SEQUENCE");
  if (move.t < 0 || move.t < state.lastT) return refuse("LOG_TIME");
  const result = applyChecked(state, move, rules);
  if ("refused" in result) return result;
  return { ...result, state: { ...result.state, lastN: move.n, lastT: move.t } };
}

function applyChecked(state: BoardState, move: Move, rules: Rules): MoveResult {
  switch (move.op) {
    case "enter":
    case "note":
    case "erase": {
      const index = cellIndex(move.cell);
      const guard = guardFor(cellKind(state, index), move.op);
      if (guard === "given") return refuse("GIVEN_CELL", guard);
      if (guard) return refuse("LOCKED_CELL", guard);
      if (state.standing.lost) return refuse("MISTAKE_LIMIT");
      if (move.op === "enter") return enterDigit(state, index, move.digit, rules);
      if (move.op === "note") return toggleNote(state, index, move.digit);
      return eraseCell(state, index);
    }
    case "hint": {
      const pick = chooseHint(state);
      if (!pick || pick.cell !== move.cell || pick.digit !== move.digit) return refuse("HINT_MISMATCH");
      if (state.hints >= rules.hintLimit) return refuse("HINT_LIMIT");
      if (state.standing.lost) return refuse("MISTAKE_LIMIT");
      return hintCell(state, cellIndex(pick.cell), pick.digit);
    }
    case "second_chance":
      if (!state.standing.lost || state.secondChanceUsed) return refuse("MISTAKE_LIMIT");
      return secondChance(state, state.standing.edit, state.standing.cell, rules);
    case "undo":
      return state.standing.lost ? refuse("MISTAKE_LIMIT") : undo(state);
    case "redo":
      return state.standing.lost ? refuse("MISTAKE_LIMIT") : redo(state);
    case "pause":
    case "resume":
      return state.standing.lost ? refuse("MISTAKE_LIMIT") : { state, logged: true, effect: { kind: move.op } };
  }
}

/** Replays a log from the start board; stops at the first move a check refuses. */
export function replay(initial: BoardState, moves: readonly Move[], rules: Rules): Replayed {
  let state = initial;
  for (const move of moves) {
    const result = applyMove(state, move, rules);
    if ("refused" in result) return { state, failure: { failure: result.refused, move: move.n } };
    state = result.state;
  }
  return { state, failure: null };
}
