// The line board as cells: each station's 15-minute cells from 05:00 to 24:00 with their state, and the
// painted band fitted against them exactly as the server will judge the cells (spanCells).

import type { Role, Segment } from "../../shared/api.js";
import { BOARD_CLOSES, BOARD_OPENS, CELL_MINUTES, parseClock, spanCells } from "../../shared/rules.js";

export const COLUMNS = (BOARD_CLOSES - BOARD_OPENS) / CELL_MINUTES;

type BaseState = "free" | "past" | "occupied" | "your hold" | "your booking" | "cleaning tail";
export type CellState = BaseState | "painting" | "conflict";

export interface BoardCell {
  state: BaseState;
  /** The hold or booking this cell belongs to, when the viewer may act on it. */
  ownerId: string | null;
  ownerKind: "hold" | "booking" | null;
}

export const minuteOf = (column: number): number => BOARD_OPENS + column * CELL_MINUTES;
export const columnOf = (minute: number): number => (minute - BOARD_OPENS) / CELL_MINUTES;

/** Minutes since midnight of an "HH:MM" the server wrote (24:00 allowed as an end). */
export function minutesOf(value: string): number {
  return parseClock(value, true) ?? BOARD_OPENS;
}

function columnsOf(start: string, end: string): number[] {
  return spanCells(minutesOf(start), minutesOf(end)).map(columnOf);
}

/** Cells for one station row. `pastBefore` is the first minute of the shown date that is not in the past. */
export function stationCells(segments: Segment[], role: Role, pastBefore: number): BoardCell[] {
  const cells: BoardCell[] = Array.from({ length: COLUMNS }, (_, column) => ({
    state: minuteOf(column) < pastBefore ? "past" : "free",
    ownerId: null,
    ownerKind: null,
  }));
  const mark = (columns: number[], state: BaseState, ownerId: string | null, ownerKind: BoardCell["ownerKind"]) => {
    for (const column of columns) if (column >= 0 && column < COLUMNS) cells[column] = { state, ownerId, ownerKind };
  };
  for (const segment of segments) {
    if (segment.kind === "occupied" || role === "operator") {
      mark(columnsOf(segment.start, segment.kind === "occupied" ? segment.end : segment.tail_end), "occupied", null, null);
      continue;
    }
    const body: BaseState = segment.kind === "hold" ? "your hold" : "your booking";
    mark(columnsOf(segment.start, segment.end), body, segment.id, segment.kind);
    mark(columnsOf(segment.end, segment.tail_end), "cleaning tail", segment.id, segment.kind);
  }
  return cells;
}

interface Fit {
  /** First and one-past-last column of the band that fits, or null when no cell fits. */
  band: { start: number; end: number } | null;
  tailEnd: number;
  conflicts: Map<number, "Taken" | "Cleaning clash">;
}

/**
 * The band from the anchor cell toward the pointer cell, stopped at the last cell whose band and cleaning
 * tail meet no occupied span, past cell or 24:00. Obstacles the wanted band or tail would hit are conflicts.
 */
export function fitBand(cells: BoardCell[], anchor: number, pointer: number, tailCells: number): Fit {
  const blocked = (column: number) => column >= COLUMNS || cells[column].state !== "free";
  const clear = (from: number, to: number) => {
    for (let column = from; column < to; column += 1) if (blocked(column)) return false;
    return true;
  };
  let band: Fit["band"] = null;
  let lo: number;
  let hi: number;
  if (pointer >= anchor) {
    for (let last = anchor; last <= pointer; last += 1) {
      if (!clear(anchor, last + 1 + tailCells)) break;
      band = { start: anchor, end: last + 1 };
    }
    lo = anchor;
    hi = pointer + 1 + tailCells;
  } else {
    const tailClear = clear(anchor + 1, anchor + 1 + tailCells);
    for (let first = anchor; first >= pointer && tailClear; first -= 1) {
      if (!clear(first, anchor + 1)) break;
      band = { start: first, end: anchor + 1 };
    }
    lo = pointer;
    hi = anchor + 1 + tailCells;
  }
  const conflicts = new Map<number, "Taken" | "Cleaning clash">();
  for (let column = lo; column < Math.min(hi, COLUMNS); column += 1) {
    const state = cells[column].state;
    if (state !== "free") conflicts.set(column, state === "cleaning tail" ? "Cleaning clash" : "Taken");
  }
  return { band, tailEnd: band ? band.end + tailCells : anchor, conflicts };
}

/** Consecutive columns grouped into runs, for drawing one overlay per run. */
export function runs<T>(columns: Map<number, T>): { start: number; end: number; value: T }[] {
  const sorted = [...columns.entries()].sort((a, b) => a[0] - b[0]);
  const out: { start: number; end: number; value: T }[] = [];
  for (const [column, value] of sorted) {
    const last = out[out.length - 1];
    if (last && last.end === column && last.value === value) last.end = column + 1;
    else out.push({ start: column, end: column + 1, value });
  }
  return out;
}
