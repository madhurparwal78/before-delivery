import { CELL_COUNT, DIGITS, cellName, columnOf, rowOf, type CellName, type Digit } from "../../shared/board";
import { guardFor } from "../../shared/moves";
import type { Player, Room, ServerMessage } from "../../shared/protocol";
import { announce } from "../announcer";
import { formatClock } from "../format";
import { LiveSocket } from "../liveSocket";
import { Store } from "../store";
import { focusCell } from "./session";
import { firstEmpty, type BoardView, type CellView } from "./view";
import { M40 } from "../messages";
import { entered, erased, noted, refusal } from "./sentences";

type YouMessage = Extract<ServerMessage, { type: "you" }>;
type ResultMessage = Extract<ServerMessage, { type: "result" }>;

type Phase = "loading" | "missing" | "unavailable" | "lobby" | "countdown" | "playing" | "over";

type Request = { cell: number } & ({ op: "enter" | "note"; digit: Digit } | { op: "erase" | "undo" | "redo" });

/** A move sent and not yet answered, with the board it was made on. */
interface Pending {
  request: Request;
  before: readonly CellView[];
}

interface DuelState {
  phase: Phase;
  room: Room | null;
  countdown: number | null;
  puzzle: string | null;
  you: YouMessage | null;
  opponent: { correct: number; mistakes: number; presence: string | null };
  result: ResultMessage | null;
  selected: number;
  notesMode: boolean;
}

const emptyYou = (puzzle: string): YouMessage => ({
  type: "you",
  values: puzzle,
  wrong: [],
  hinted: [],
  notes: {},
  correct: 0,
  mistakes: 0,
});

/** A duel room page: the socket, the server's view of your board, and the opponent's progress. */
export class DuelSession {
  readonly state = new Store<DuelState>({
    phase: "loading",
    room: null,
    countdown: null,
    puzzle: null,
    you: null,
    opponent: { correct: 0, mistakes: 0, presence: null },
    result: null,
    selected: 0,
    notesMode: false,
  });
  private socket: LiveSocket | null = null;
  private pending: Pending[] = [];
  private started: number | null = null;
  /** True when the page opened on a duel already in play: a returning player is not told the duel has started. */
  private rejoined = false;

  constructor(
    readonly code: string,
    private readonly me: Player,
    private readonly mistakeLimit: number,
  ) {}

  open(room: Room): void {
    this.rejoined = room.state === "playing";
    this.apply({ room, phase: phaseOf(room) });
    this.socket = new LiveSocket(
      (message) => this.receive(message),
      () => this.socket?.send({ type: "room", code: this.code }),
    );
  }

  fail(phase: "missing" | "unavailable"): void {
    this.apply({ phase });
    if (phase === "unavailable") announce(M40);
  }

  close(): void {
    this.socket?.close();
  }

  private apply(change: Partial<DuelState>): void {
    this.state.set({ ...this.state.get(), ...change });
  }

  readonly elapsed = (): number => (this.started === null ? 0 : performance.now() - this.started);

  get opponentName(): string {
    const seats = this.state.get().room?.seats ?? [];
    return seats.find((seat) => seat.display_name !== this.me.display_name)?.display_name ?? "";
  }

  get slots(): number {
    return [...(this.state.get().puzzle ?? "")].filter((char) => char === "0").length;
  }

  view(): BoardView {
    const { puzzle, you, selected, phase } = this.state.get();
    const board = puzzle ?? "0".repeat(CELL_COUNT);
    const mine = you ?? emptyYou(board);
    const cells: CellView[] = Array.from({ length: CELL_COUNT }, (_, index) => {
      const value = Number(mine.values[index] ?? 0);
      const given = board[index] !== "0";
      const kind = given ? "given" : value === 0 ? "empty" : mine.wrong.includes(cellName(index)) ? "wrong" : "correct";
      const notes = (mine.notes[cellName(index)] ?? []).reduce((mask, digit) => mask | (1 << digit), 0);
      return { kind, value, notes };
    });
    const won = this.state.get().result?.outcome;
    const mode = phase !== "over" ? "playing" : won === "win" || won === "opponent_out" || won === "forfeit_win" ? "won" : "lost";
    return { mode, cells, selected };
  }

  private receive(message: ServerMessage): void {
    switch (message.type) {
      case "room":
        this.apply({ room: message.room });
        if (this.state.get().phase === "lobby" || this.state.get().phase === "countdown") {
          this.apply({ phase: message.room.state === "playing" ? "countdown" : phaseOf(message.room) });
        }
        return;
      case "countdown":
        this.apply({ countdown: message.seconds_left, phase: "countdown" });
        announce(`Starting in ${message.seconds_left}`);
        return;
      case "start":
        this.started ??= performance.now();
        this.apply({ puzzle: message.puzzle, phase: "playing", selected: Math.max(0, message.puzzle.indexOf("0")) });
        if (!this.rejoined) announce("The duel has started.");
        return;
      case "you":
        this.receiveBoard(message);
        return;
      case "progress":
        this.apply({ opponent: { ...this.state.get().opponent, correct: message.correct, mistakes: message.mistakes } });
        return;
      case "presence": {
        const sentence = message.state === "back" ? `${message.display_name} is back.` : `${message.display_name} is reconnecting.`;
        this.apply({ opponent: { ...this.state.get().opponent, presence: sentence } });
        announce(sentence);
        return;
      }
      case "result":
        this.apply({ result: message, phase: "over" });
        announce(this.resultSentence(message));
        return;
      case "error":
        if (message.code === "LIVE_UNAVAILABLE") {
          this.socket?.close();
          this.fail("unavailable");
        } else if (message.code === "ROOM_NOT_FOUND") this.fail("missing");
        return;
      case "leaderboard":
        return;
    }
  }

  private receiveBoard(you: YouMessage): void {
    const previous = this.state.get();
    const first = previous.you === null && previous.puzzle !== null;
    this.apply({ you });
    if (first) this.apply({ selected: firstEmpty(this.view().cells) });
    const pending = this.pending.shift();
    const sentence = pending && this.sentenceFor(pending, you);
    if (sentence) announce(sentence);
  }

  /** What the server's answer to a move says happened; nothing when the move changed nothing. */
  private sentenceFor({ request, before }: Pending, you: YouMessage): string | null {
    const after = this.view().cells;
    const changed = JSON.stringify(after) !== JSON.stringify(before);
    const cell: CellName = cellName(request.cell);
    switch (request.op) {
      case "enter":
        return changed ? entered(cell, request.digit, after[request.cell]?.kind !== "wrong", you.mistakes, this.mistakeLimit) : null;
      case "note":
        return changed ? noted(cell, request.digit, ((after[request.cell]?.notes ?? 0) & (1 << request.digit)) !== 0) : null;
      case "erase":
        return changed ? erased(cell) : null;
      case "undo":
        return changed ? "Undone." : "Nothing to undo.";
      case "redo":
        return changed ? "Redone." : "Nothing to redo.";
    }
  }

  resultSentence(result: ResultMessage): string {
    const time = result.seconds === null ? "" : formatClock(result.seconds);
    switch (result.outcome) {
      case "win":
        return `You win! You finished first in ${time}.`;
      case "loss":
        return result.seconds === null ? `${result.winner} wins.` : `${result.winner} wins. They finished first in ${time}.`;
      case "tie":
        return "It's a tie.";
      case "out":
        return `You're out: ${this.mistakeLimit} mistakes. ${result.winner} wins.`;
      case "opponent_out":
        return `${this.opponentName} is out. You win.`;
      case "forfeit_win":
        return `${this.opponentName} left the duel. You win.`;
    }
  }

  // ---- input ----------------------------------------------------------------------------------------

  get playing(): boolean {
    return this.state.get().phase === "playing";
  }

  setReady(ready: boolean): void {
    this.socket?.send({ type: "ready", ready });
  }

  select(index: number): void {
    if (!this.playing) return;
    this.apply({ selected: index });
    focusCell(index);
  }

  toggleNotes(): void {
    if (!this.playing) return;
    const notesMode = !this.state.get().notesMode;
    this.apply({ notesMode });
    announce(notesMode ? "Notes on." : "Notes off.");
  }

  private send(request: Request): void {
    const cells = this.view().cells;
    if (request.op === "enter" || request.op === "note" || request.op === "erase") {
      const guard = guardFor(cells[request.cell]?.kind ?? "empty", request.op);
      if (guard) {
        const sentence = refusal(guard);
        if (sentence) announce(sentence);
        return;
      }
    }
    this.pending.push({ request, before: cells });
    const cell = cellName(request.cell);
    switch (request.op) {
      case "enter":
      case "note":
        this.socket?.send({ type: "move", op: request.op, cell, digit: request.digit });
        return;
      case "erase":
        this.socket?.send({ type: "move", op: "erase", cell });
        return;
      case "undo":
      case "redo":
        this.socket?.send({ type: "move", op: request.op });
    }
  }

  enter(digit: Digit): void {
    if (!this.playing) return;
    const { selected, notesMode } = this.state.get();
    this.send({ op: notesMode ? "note" : "enter", cell: selected, digit });
  }

  erase(): void {
    if (this.playing) this.send({ op: "erase", cell: this.state.get().selected });
  }

  undo(): void {
    if (this.playing) this.send({ op: "undo", cell: this.state.get().selected });
  }

  redo(): void {
    if (this.playing) this.send({ op: "redo", cell: this.state.get().selected });
  }

  handleKey(event: KeyboardEvent): boolean {
    const target = event.target;
    if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return false;
    if (event.altKey || this.state.get().phase !== "playing") return false;
    const key = event.key;
    const letter = key.toLowerCase();
    if (event.ctrlKey || event.metaKey) {
      if (letter === "z") (event.shiftKey ? this.redo() : this.undo());
      else if (letter === "y" && event.ctrlKey) this.redo();
      else return false;
      return true;
    }
    const { selected } = this.state.get();
    const step = (rows: number, columns: number): void => this.select(((rowOf(selected) + rows + 9) % 9) * 9 + ((columnOf(selected) + columns + 9) % 9));
    const digit = DIGITS.find((candidate) => String(candidate) === key);
    if (digit !== undefined) this.enter(digit);
    else if (key === "ArrowUp") step(-1, 0);
    else if (key === "ArrowDown") step(1, 0);
    else if (key === "ArrowLeft") step(0, -1);
    else if (key === "ArrowRight") step(0, 1);
    else if (key === "Home") this.select(rowOf(selected) * 9);
    else if (key === "End") this.select(rowOf(selected) * 9 + 8);
    else if (key === "Delete" || key === "Backspace") this.erase();
    else if (letter === "n") this.toggleNotes();
    else if (letter === "h") announce("Hints are off in duels.");
    else if (letter === "p") announce("Duels can't be paused.");
    else return false;
    return true;
  }
}

function phaseOf(room: Room): Phase {
  switch (room.state) {
    case "open":
    case "seated":
      return "lobby";
    case "countdown":
      return "countdown";
    case "playing":
      return "playing";
    default:
      return "over";
  }
}
