import { CELL_COUNT, boxOf, columnOf, rowOf } from "../../shared/board";
import { cellKind, type BoardState, type CellKind } from "../../shared/moves";

type BoardMode = "playing" | "paused" | "lost" | "won";

export interface CellView {
  kind: CellKind;
  value: number;
  /** Notes as a bitmask: bit d is set for digit d. */
  notes: number;
}

/** What the board draws, whether it comes from a local game or from the server's `you` message. */
export interface BoardView {
  mode: BoardMode;
  cells: readonly CellView[];
  selected: number;
}

export function cellsOfState(state: BoardState): CellView[] {
  return Array.from({ length: CELL_COUNT }, (_, index) => ({
    kind: cellKind(state, index),
    value: state.values[index] ?? 0,
    notes: state.notes[index] ?? 0,
  }));
}

/** 9 minus the cells holding the digit as a given, a hinted cell or a correct entry. */
export function remaining(cells: readonly CellView[], digit: number): number {
  return 9 - cells.filter((cell) => cell.value === digit && cell.kind !== "wrong").length;
}

/**
 * Highlight tokens of every cell: `row`, `column`, `box` in that order, then `same-digit`; the selected cell
 * reads `selected`. Nothing is highlighted while the board is paused, lost or won.
 */
export function highlights(view: BoardView): string[] {
  if (view.mode !== "playing") return view.cells.map(() => "");
  const selected = view.selected;
  const held = view.cells[selected]?.value ?? 0;
  return view.cells.map((cell, index) => {
    if (index === selected) return "selected";
    const tokens: string[] = [];
    if (rowOf(index) === rowOf(selected)) tokens.push("row");
    if (columnOf(index) === columnOf(selected)) tokens.push("column");
    if (boxOf(index) === boxOf(selected)) tokens.push("box");
    if (held !== 0 && cell.value === held) tokens.push("same-digit");
    return tokens.join(" ");
  });
}

/** The first cell without a value in reading order, where a game opens. */
export function firstEmpty(cells: readonly CellView[]): number {
  const found = cells.findIndex((cell) => cell.value === 0);
  return found < 0 ? 0 : found;
}
