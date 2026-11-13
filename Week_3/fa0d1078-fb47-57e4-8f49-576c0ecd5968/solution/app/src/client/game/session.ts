import { DIGITS, cellIndex, cellName, columnOf, rowOf, type CellName, type Digit } from "../../shared/board";
import {
  applyMove,
  chooseHint,
  stitchCount,
  initialBoard,
  isSolved,
  replay,
  type BoardState,
  type Move,
  type MoveEffect,
  type Rules,
  type Stamp,
} from "../../shared/moves";
import type { ClientConfig, Game, Result } from "../../shared/protocol";
import { ApiFailure, post, put } from "../api";
import { announce } from "../announcer";
import { formatClock } from "../format";
import { M56 } from "../messages";
import { Store } from "../store";
import { celebrate } from "./celebrate";
import { entered, erased, hinted, noted, refusal, secondChance } from "./sentences";
import { cellsOfState, firstEmpty, type BoardView } from "./view";

type Dialogue = null | "paused" | "over" | "solved" | "refused";

interface PlayState {
  board: BoardState;
  selected: number;
  notesMode: boolean;
  paused: boolean;
  dialog: Dialogue;
  checking: boolean;
  saveFailed: boolean;
  /** An unexpected failure (M56) shown under the board. */
  failure: string | null;
  refusal: string | null;
  result: Result | null;
  won: boolean;
}

function sentenceOf(effect: MoveEffect, state: BoardState, rules: Rules): string {
  switch (effect.kind) {
    case "enter":
      return entered(effect.cell, effect.digit, effect.correct, state.mistakes, rules.mistakeLimit);
    case "note":
      return noted(effect.cell, effect.digit, effect.added);
    case "erase":
      return erased(effect.cell);
    case "hint":
      return hinted(effect.cell, effect.digit, rules.hintLimit - state.hints);
    case "undo":
      return "Undone.";
    case "redo":
      return "Redone.";
    case "second_chance":
      return secondChance(state.mistakes, rules.mistakeLimit);
    case "pause":
      return "Paused.";
    case "resume":
      return "Resumed.";
  }
}

export function focusCell(index: number): void {
  document.querySelector<HTMLElement>(`[data-index="${index}"]`)?.focus();
}

/** Lets the render that follows a state change reach the DOM before the DOM is read. */
/** An automatic pause (window blur, hidden page) is saved this long after it happens: a page that is being closed fires `blur` on its way out and must not leave a pause in the log. */
const AUTO_PAUSE_SAVE_GRACE_MS = 250;

const nextRender = (): Promise<void> => new Promise((resolve) => queueMicrotask(() => queueMicrotask(resolve)));

/** One game on the Play page: the board, the move log, the clock, the saves and the finish. */
export class GameSession {
  readonly state: Store<PlayState>;
  private readonly rules: Rules;
  private readonly log: Move[];
  private banked: number;
  private since: number | null = null;
  private dirty = false;
  private saving = false;
  private finishing = false;
  private graceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly game: Game,
    config: ClientConfig,
  ) {
    this.rules = { mistakeLimit: config.mistakeLimit, hintLimit: config.hintLimit };
    const start = initialBoard(game.puzzle, game.solution, game.start);
    const board = replay(start, game.moves, this.rules).state;
    this.log = [...game.moves];
    this.banked = Math.max(game.elapsed_ms, game.moves[game.moves.length - 1]?.t ?? 0);
    this.state = new Store<PlayState>({
      board,
      selected: firstEmpty(cellsOfState(board)),
      notesMode: false,
      paused: false,
      dialog: game.status === "won" ? "solved" : board.standing.lost ? "over" : null,
      checking: false,
      saveFailed: false,
      failure: null,
      refusal: null,
      result: game.result,
      won: game.status === "won",
    });
    if (game.status === "playing" && !board.standing.lost) this.run();
  }

  // ---- clock ----------------------------------------------------------------------------------------

  /** Active time in ms: the saved time plus the page's own time since play last started. */
  readonly elapsed = (): number => this.banked + (this.since === null ? 0 : performance.now() - this.since);

  private run(): void {
    this.since ??= performance.now();
  }

  private halt(): void {
    if (this.since !== null) this.banked += performance.now() - this.since;
    this.since = null;
  }

  get running(): boolean {
    const { paused, won, board, checking } = this.state.get();
    return !paused && !won && !board.standing.lost && !checking;
  }

  // ---- view -----------------------------------------------------------------------------------------

  view(): BoardView {
    const { board, selected, paused, won } = this.state.get();
    const mode = won ? "won" : board.standing.lost ? "lost" : paused ? "paused" : "playing";
    return { mode, cells: cellsOfState(board), selected };
  }

  get closed(): boolean {
    return this.game.closed;
  }

  get limits(): Rules {
    return this.rules;
  }

  get hintsLeft(): number {
    return this.rules.hintLimit - this.state.get().board.hints;
  }

  get stitches(): number {
    return stitchCount(this.state.get().board);
  }

  /** Cells to fill at the start: the length of the thread. */
  get slots(): number {
    return [...this.game.puzzle].filter((char) => char === "0").length;
  }

  private patch(change: Partial<PlayState>): void {
    this.state.set({ ...this.state.get(), ...change });
  }

  // ---- selection ------------------------------------------------------------------------------------

  private canPlay(): boolean {
    const { dialog, paused, won, board, checking } = this.state.get();
    return dialog === null && !paused && !won && !board.standing.lost && !checking;
  }

  select(index: number): void {
    if (!this.canPlay()) return;
    this.patch({ selected: index });
    focusCell(index);
  }

  private moveSelection(rows: number, columns: number): void {
    const { selected } = this.state.get();
    this.select(((rowOf(selected) + rows + 9) % 9) * 9 + ((columnOf(selected) + columns + 9) % 9));
  }

  // ---- moves ----------------------------------------------------------------------------------------

  /** Applies a move through the shared rules; a move that counts joins the log, is announced and saved. */
  private apply(build: (stamp: Stamp) => Move, grace = false): void {
    const { board } = this.state.get();
    const move = build({ n: this.log.length + 1, t: Math.floor(this.elapsed()) });
    const result = applyMove(board, move, this.rules);
    if ("refused" in result) {
      const { code, guard } = result.refused;
      const sentence = guard ? refusal(guard) : code === "HINT_LIMIT" ? "No hints left." : null;
      if (sentence) announce(sentence);
      return;
    }
    if (!result.logged) {
      if (result.blocked === "undo") announce("Nothing to undo.");
      if (result.blocked === "redo") announce("Nothing to redo.");
      return;
    }
    this.log.push(move);
    const next = result.state;
    this.patch({ board: next, failure: null });
    announce(sentenceOf(result.effect, next, this.rules));
    if (result.effect.kind === "hint") {
      this.patch({ selected: cellIndex(result.effect.cell) });
      focusCell(cellIndex(result.effect.cell));
    }
    if (grace) this.saveAfterGrace();
    else this.save();
    if (next.standing.lost) this.lose(next);
    else if (isSolved(next)) void this.finish();
  }

  private lose(board: BoardState): void {
    this.halt();
    this.patch({ dialog: "over" });
    announce(`Game over. ${board.mistakes} mistakes.`);
  }

  private selectedCell(): CellName {
    return cellName(this.state.get().selected);
  }

  enter(digit: Digit): void {
    if (!this.canPlay()) return;
    const op = this.state.get().notesMode ? "note" : "enter";
    const cell = this.selectedCell();
    this.apply((stamp) => ({ ...stamp, op, cell, digit }));
  }

  erase(): void {
    if (!this.canPlay()) return;
    const cell = this.selectedCell();
    this.apply((stamp) => ({ ...stamp, op: "erase", cell }));
  }

  undo(): void {
    if (this.canPlay()) this.apply((stamp) => ({ ...stamp, op: "undo" }));
  }

  redo(): void {
    if (this.canPlay()) this.apply((stamp) => ({ ...stamp, op: "redo" }));
  }

  toggleNotes(): void {
    if (!this.canPlay()) return;
    const notesMode = !this.state.get().notesMode;
    this.patch({ notesMode });
    announce(notesMode ? "Notes on." : "Notes off.");
  }

  hint(): void {
    if (!this.canPlay()) return;
    const pick = chooseHint(this.state.get().board);
    if (pick) this.apply((stamp) => ({ ...stamp, op: "hint", cell: pick.cell, digit: pick.digit }));
  }

  // ---- pause and second chance ----------------------------------------------------------------------

  /** `auto` marks a pause the page made itself (blur, hidden page): the board pauses at once, the save follows after a short grace. */
  pause(auto = false): void {
    if (!this.canPlay()) return;
    this.apply((stamp) => ({ ...stamp, op: "pause" }), auto);
    this.halt();
    this.patch({ paused: true, dialog: "paused" });
  }

  resume(): void {
    if (!this.state.get().paused) return;
    this.patch({ paused: false, dialog: null });
    this.apply((stamp) => ({ ...stamp, op: "resume" }));
    this.run();
    focusCell(this.state.get().selected);
  }

  secondChance(): void {
    if (!this.state.get().board.standing.lost) return;
    this.patch({ dialog: null });
    this.apply((stamp) => ({ ...stamp, op: "second_chance" }));
    this.run();
    focusCell(this.state.get().selected);
  }

  // ---- saving ---------------------------------------------------------------------------------------

  private saveAfterGrace(): void {
    this.graceTimer ??= setTimeout(() => this.save(), AUTO_PAUSE_SAVE_GRACE_MS);
  }

  private save(): void {
    if (this.graceTimer !== null) clearTimeout(this.graceTimer);
    this.graceTimer = null;
    this.dirty = true;
    void this.flush();
  }

  /** Sends the whole log with the active time; a failed save is retried with the next move or resume. */
  private async flush(): Promise<void> {
    if (this.saving) return;
    this.saving = true;
    while (this.dirty) {
      this.dirty = false;
      try {
        await put(`/api/games/${this.game.id}/moves`, { moves: this.log, elapsed_ms: Math.floor(this.elapsed()) });
        if (this.state.get().saveFailed) this.patch({ saveFailed: false });
      } catch (error) {
        if (error instanceof ApiFailure && error.status >= 400 && error.status < 500) continue;
        this.dirty = true;
        this.patch({ saveFailed: true });
        announce("Your game wasn't saved. It will be saved with your next move.");
        break;
      }
    }
    this.saving = false;
  }

  // ---- finishing ------------------------------------------------------------------------------------

  /** Sends the whole log; a 200 plays the solved sequence, a 4xx opens `Not counted`, anything else is M56. */
  private async finish(): Promise<void> {
    if (this.finishing) return;
    this.finishing = true;
    this.patch({ checking: true });
    this.halt();
    announce("Checking your game.");
    try {
      const { result } = await post<{ result: Result }>(`/api/games/${this.game.id}/finish`, { moves: this.log });
      this.patch({ checking: false, won: true, result });
      await nextRender();
      await celebrate();
      this.patch({ dialog: "solved" });
      announce(`Solved in ${formatClock(result.seconds)}. Score ${result.score}.`);
    } catch (error) {
      this.finishing = false;
      this.patch({ checking: false });
      this.run();
      if (error instanceof ApiFailure && error.status >= 400 && error.status < 500) {
        const sentence = `This game could not be verified (${error.code}). It was not counted.`;
        this.patch({ dialog: "refused", refusal: sentence });
        announce(sentence);
      } else {
        this.patch({ failure: M56 });
        announce(M56);
      }
    }
  }

  closeDialog(): void {
    this.patch({ dialog: null });
  }

  // ---- keyboard -------------------------------------------------------------------------------------

  /** Handles a shortcut anywhere on the play page; true when the key was used. */
  handleKey(event: KeyboardEvent): boolean {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false;
    if (event.altKey) return false;
    const key = event.key;
    const letter = key.toLowerCase();
    const { dialog, selected } = this.state.get();
    if (dialog !== null) {
      if (dialog === "paused" && letter === "p" && !event.ctrlKey && !event.metaKey) {
        this.resume();
        return true;
      }
      return false;
    }
    if (event.ctrlKey || event.metaKey) {
      if (letter === "z" && event.shiftKey) this.redo();
      else if (letter === "z") this.undo();
      else if (letter === "y" && event.ctrlKey) this.redo();
      else return false;
      return true;
    }
    const digit = DIGITS.find((candidate) => String(candidate) === key);
    if (digit !== undefined) this.enter(digit);
    else if (key === "ArrowUp") this.moveSelection(-1, 0);
    else if (key === "ArrowDown") this.moveSelection(1, 0);
    else if (key === "ArrowLeft") this.moveSelection(0, -1);
    else if (key === "ArrowRight") this.moveSelection(0, 1);
    else if (key === "Home") this.select(rowOf(selected) * 9);
    else if (key === "End") this.select(rowOf(selected) * 9 + 8);
    else if (key === "Delete" || key === "Backspace") this.erase();
    else if (letter === "n") this.toggleNotes();
    else if (letter === "h") this.hint();
    else if (letter === "p") this.pause();
    else return false;
    return true;
  }

}
