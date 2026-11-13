import {
  CELLS,
  DIGITS,
  type Cell,
  type Digit,
  boardDigit,
  cellIndex,
  givenCells,
  peersOf,
} from './board';

export type MoveOp =
  | 'enter'
  | 'note'
  | 'erase'
  | 'hint'
  | 'undo'
  | 'redo'
  | 'second_chance'
  | 'pause'
  | 'resume';

export interface LoggedMove {
  n: number;
  t: number;
  op: MoveOp;
  cell?: Cell;
  digit?: Digit;
}

export interface StartEntry {
  cell: Cell;
  digit: Digit;
}

export interface StartNote {
  cell: Cell;
  digits: Digit[];
}

export interface StartBoard {
  entries: StartEntry[];
  notes: StartNote[];
  mistakes: number;
  hints: number;
  elapsed_ms: number;
  second_chance_used: boolean;
}

export interface EngineLimits {
  mistakeLimit: number;
  hintLimit: number;
}

export type Guard = 'given' | 'hinted' | 'correct';

export interface CellSnapshot {
  value: Digit | null;
  notes: Digit[];
}

/** Everything needed to undo or redo one enter, note or erase exactly. */
interface Change {
  op: 'enter' | 'note' | 'erase';
  cell: Cell;
  digit: Digit | null;
  before: CellSnapshot;
  after: CellSnapshot;
  peerNotes: StartEntry[];
}

export type EnterResult =
  | { kind: 'guard'; guard: Guard }
  | { kind: 'unchanged' }
  | { kind: 'entered'; cell: Cell; digit: Digit; correct: boolean; mistakes: number; lost: boolean };

export type NoteResult =
  | { kind: 'guard'; guard: Guard }
  | { kind: 'unchanged' }
  | { kind: 'noted'; cell: Cell; digit: Digit; added: boolean };

export type EraseResult =
  | { kind: 'guard'; guard: Guard }
  | { kind: 'unchanged' }
  | { kind: 'erased'; cell: Cell };

export type HintResult =
  | { kind: 'none-left' }
  | { kind: 'hinted'; cell: Cell; digit: Digit; hintsLeft: number };

export type SecondChanceResult =
  | { kind: 'unavailable' }
  | { kind: 'used'; cell: Cell; mistakes: number };

export class Game {
  readonly puzzle: string;
  readonly solution: string;
  readonly givens: Set<Cell>;
  readonly limits: EngineLimits;

  private readonly values = new Map<Cell, Digit>();
  private readonly cellNotes = new Map<Cell, Set<Digit>>();
  private readonly hintedCells = new Set<Cell>();
  private undoStack: Change[] = [];
  private redoStack: Change[] = [];
  private limitChange: Change | null = null;

  mistakes: number;
  hints: number;
  secondChanceUsed: boolean;

  constructor(puzzle: string, solution: string, start: StartBoard, limits: EngineLimits) {
    this.puzzle = puzzle;
    this.solution = solution;
    this.givens = givenCells(puzzle);
    this.limits = limits;
    this.mistakes = start.mistakes;
    this.hints = start.hints;
    this.secondChanceUsed = start.second_chance_used;
    for (const entry of start.entries) this.values.set(entry.cell, entry.digit);
    for (const note of start.notes) {
      if (note.digits.length > 0) this.cellNotes.set(note.cell, new Set(note.digits));
    }
  }

  solutionDigit(cell: Cell): Digit {
    const digit = boardDigit(this.solution, cell);
    if (digit === null) throw new Error(`solution has no digit at ${cell}`);
    return digit;
  }

  isGiven(cell: Cell): boolean {
    return this.givens.has(cell);
  }

  isHinted(cell: Cell): boolean {
    return this.hintedCells.has(cell);
  }

  /** A given, a hint or an entry: the digit the cell shows, if any. */
  valueAt(cell: Cell): Digit | null {
    if (this.givens.has(cell)) return boardDigit(this.puzzle, cell);
    return this.values.get(cell) ?? null;
  }

  /** The digit a player put in the cell, excluding givens. */
  entryAt(cell: Cell): Digit | null {
    return this.values.get(cell) ?? null;
  }

  isWrong(cell: Cell): boolean {
    const entry = this.values.get(cell);
    return entry !== undefined && entry !== this.solutionDigit(cell);
  }

  isCorrectEntry(cell: Cell): boolean {
    const entry = this.values.get(cell);
    return entry !== undefined && entry === this.solutionDigit(cell);
  }

  /** Givens, hinted cells and correct entries refuse every change. */
  lockGuard(cell: Cell): Guard | null {
    if (this.givens.has(cell)) return 'given';
    if (this.hintedCells.has(cell)) return 'hinted';
    if (this.isCorrectEntry(cell)) return 'correct';
    return null;
  }

  notesAt(cell: Cell): Digit[] {
    const notes = this.cellNotes.get(cell);
    return notes ? [...notes].sort((a, b) => a - b) : [];
  }

  get lost(): boolean {
    return this.mistakes >= this.limits.mistakeLimit;
  }

  get hintsLeft(): number {
    return Math.max(0, this.limits.hintLimit - this.hints);
  }

  /** Correct non-given cells: the player's stitches, hints and seeds included. */
  get correctCount(): number {
    let count = 0;
    for (const [cell, digit] of this.values) if (digit === this.solutionDigit(cell)) count += 1;
    return count;
  }

  get emptyAtStartCount(): number {
    return 81 - this.givens.size;
  }

  get solved(): boolean {
    return this.correctCount === this.emptyAtStartCount;
  }

  /** The board the player sees: givens plus every entry. */
  get valueBoard(): string {
    return CELLS.map((cell) => String(this.valueAt(cell) ?? 0)).join('');
  }

  get wrongCells(): Cell[] {
    return CELLS.filter((cell) => this.isWrong(cell));
  }

  get hintedList(): Cell[] {
    return CELLS.filter((cell) => this.hintedCells.has(cell));
  }

  get notesMap(): Record<Cell, Digit[]> {
    const map: Record<Cell, Digit[]> = {};
    for (const cell of CELLS) {
      const notes = this.notesAt(cell);
      if (notes.length > 0) map[cell] = notes;
    }
    return map;
  }

  /** 9 minus the cells holding the digit as a given, a hint or a correct entry. */
  remainingFor(digit: Digit): number {
    let placed = 0;
    for (const cell of CELLS) {
      if (this.givens.has(cell)) {
        if (boardDigit(this.puzzle, cell) === digit) placed += 1;
      } else if (this.values.get(cell) === digit && this.isCorrectEntry(cell)) {
        placed += 1;
      }
    }
    return 9 - placed;
  }

  private snapshot(cell: Cell): CellSnapshot {
    return { value: this.values.get(cell) ?? null, notes: this.notesAt(cell) };
  }

  private restore(cell: Cell, snapshot: CellSnapshot): void {
    if (snapshot.value === null) this.values.delete(cell);
    else this.values.set(cell, snapshot.value);
    if (snapshot.notes.length === 0) this.cellNotes.delete(cell);
    else this.cellNotes.set(cell, new Set(snapshot.notes));
  }

  private removePeerNotes(cell: Cell, digit: Digit): StartEntry[] {
    const removed: StartEntry[] = [];
    for (const peer of peersOf(cell)) {
      const notes = this.cellNotes.get(peer);
      if (notes?.delete(digit)) {
        removed.push({ cell: peer, digit });
        if (notes.size === 0) this.cellNotes.delete(peer);
      }
    }
    return removed;
  }

  private addPeerNotes(peerNotes: readonly StartEntry[]): void {
    for (const note of peerNotes) {
      const notes = this.cellNotes.get(note.cell) ?? new Set<Digit>();
      notes.add(note.digit);
      this.cellNotes.set(note.cell, notes);
    }
  }

  private record(change: Change): void {
    this.undoStack.push(change);
    this.redoStack = [];
  }

  enter(cell: Cell, digit: Digit): EnterResult {
    const guard = this.lockGuard(cell);
    if (guard) return { kind: 'guard', guard };
    if (this.values.get(cell) === digit) return { kind: 'unchanged' };

    const before = this.snapshot(cell);
    this.values.set(cell, digit);
    this.cellNotes.delete(cell);
    const peerNotes = this.removePeerNotes(cell, digit);
    const change: Change = {
      op: 'enter',
      cell,
      digit,
      before,
      after: this.snapshot(cell),
      peerNotes,
    };
    this.record(change);

    const correct = digit === this.solutionDigit(cell);
    if (!correct) {
      this.mistakes += 1;
      if (this.lost) this.limitChange = change;
    }
    return { kind: 'entered', cell, digit, correct, mistakes: this.mistakes, lost: this.lost };
  }

  toggleNote(cell: Cell, digit: Digit): NoteResult {
    const guard = this.lockGuard(cell);
    if (guard) return { kind: 'guard', guard };
    if (this.values.has(cell)) return { kind: 'unchanged' };

    const before = this.snapshot(cell);
    const notes = this.cellNotes.get(cell) ?? new Set<Digit>();
    const added = !notes.delete(digit);
    if (added) notes.add(digit);
    if (notes.size === 0) this.cellNotes.delete(cell);
    else this.cellNotes.set(cell, notes);
    this.record({
      op: 'note',
      cell,
      digit,
      before,
      after: this.snapshot(cell),
      peerNotes: [],
    });
    return { kind: 'noted', cell, digit, added };
  }

  erase(cell: Cell): EraseResult {
    const guard = this.lockGuard(cell);
    if (guard) return { kind: 'guard', guard };
    const hasEntry = this.values.has(cell);
    const hasNotes = this.notesAt(cell).length > 0;
    if (!hasEntry && !hasNotes) return { kind: 'unchanged' };

    const before = this.snapshot(cell);
    this.values.delete(cell);
    this.cellNotes.delete(cell);
    this.record({
      op: 'erase',
      cell,
      digit: null,
      before,
      after: this.snapshot(cell),
      peerNotes: [],
    });
    return { kind: 'erased', cell };
  }

  /** The cell with the fewest candidates, ties by lowest row then column. */
  pickHintCell(): Cell | null {
    let best: Cell | null = null;
    let bestCount = Number.POSITIVE_INFINITY;
    for (const cell of CELLS) {
      if (this.givens.has(cell) || this.hintedCells.has(cell)) continue;
      if (this.isCorrectEntry(cell)) continue;
      const count = this.candidatesOf(cell).length;
      if (count < bestCount) {
        best = cell;
        bestCount = count;
      }
    }
    return best;
  }

  /**
   * Digits missing from the cell's row, column and box, counting only
   * givens, hinted cells and correct entries.
   */
  candidatesOf(cell: Cell): Digit[] {
    const seen = new Set<Digit>();
    for (const other of peersOf(cell)) {
      if (this.givens.has(other)) {
        const digit = boardDigit(this.puzzle, other);
        if (digit !== null) seen.add(digit);
      } else if (this.isCorrectEntry(other)) {
        seen.add(this.values.get(other) as Digit);
      }
    }
    return DIGITS.filter((digit) => !seen.has(digit));
  }

  hint(): HintResult {
    if (this.hintsLeft <= 0) return { kind: 'none-left' };
    const cell = this.pickHintCell();
    if (cell === null) return { kind: 'none-left' };
    this.applyHint(cell, this.solutionDigit(cell));
    return { kind: 'hinted', cell, digit: this.solutionDigit(cell), hintsLeft: this.hintsLeft };
  }

  /** Used by the replay once a logged hint has been checked against the rule. */
  applyHint(cell: Cell, digit: Digit): void {
    this.values.set(cell, digit);
    this.cellNotes.delete(cell);
    this.hintedCells.add(cell);
    this.removePeerNotes(cell, digit);
    this.hints += 1;
    this.undoStack = [];
    this.redoStack = [];
    this.limitChange = null;
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): boolean {
    const change = this.undoStack.pop();
    if (!change) return false;
    this.restore(change.cell, change.before);
    this.addPeerNotes(change.peerNotes);
    this.redoStack.push(change);
    return true;
  }

  redo(): boolean {
    const change = this.redoStack.pop();
    if (!change) return false;
    this.restore(change.cell, change.after);
    for (const note of change.peerNotes) {
      const notes = this.cellNotes.get(note.cell);
      if (notes?.delete(note.digit) && notes.size === 0) this.cellNotes.delete(note.cell);
    }
    this.undoStack.push(change);
    return true;
  }

  get secondChanceAvailable(): boolean {
    return this.lost && !this.secondChanceUsed && this.limitChange !== null;
  }

  secondChance(): SecondChanceResult {
    const change = this.limitChange;
    if (!this.lost || this.secondChanceUsed || !change) return { kind: 'unavailable' };
    this.restore(change.cell, change.before);
    this.addPeerNotes(change.peerNotes);
    this.mistakes = this.limits.mistakeLimit - 1;
    this.secondChanceUsed = true;
    this.limitChange = null;
    this.undoStack = [];
    this.redoStack = [];
    return { kind: 'used', cell: change.cell, mistakes: this.mistakes };
  }

  /** The cell a player's selection starts on: the first empty cell in reading order. */
  firstEmptyCell(): Cell {
    for (const cell of CELLS) if (this.valueAt(cell) === null) return cell;
    return CELLS[0] as Cell;
  }

  startBoardSnapshot(elapsedMs: number): StartBoard {
    const entries: StartEntry[] = [];
    for (const cell of CELLS) {
      const digit = this.values.get(cell);
      if (digit !== undefined) entries.push({ cell, digit });
    }
    const notes: StartNote[] = [];
    for (const cell of CELLS) {
      const cellNotes = this.notesAt(cell);
      if (cellNotes.length > 0) notes.push({ cell, digits: cellNotes });
    }
    entries.sort((a, b) => cellIndex(a.cell) - cellIndex(b.cell));
    return {
      entries,
      notes,
      mistakes: this.mistakes,
      hints: this.hints,
      elapsed_ms: elapsedMs,
      second_chance_used: this.secondChanceUsed,
    };
  }
}

export function emptyStartBoard(): StartBoard {
  return {
    entries: [],
    notes: [],
    mistakes: 0,
    hints: 0,
    elapsed_ms: 0,
    second_chance_used: false,
  };
}
