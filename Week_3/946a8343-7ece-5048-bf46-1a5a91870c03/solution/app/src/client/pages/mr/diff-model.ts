// The diff screen's pure logic: rows of a file, row labels, where threads sit, and range selection. No DOM and no requests.
import { DEFAULT_CONTEXT, expandedRows, splitRows, type DiffOp, type Expansion, type HunkLine, type LineRow } from "../../../shared/diff.ts";
import type { Column, CommentTarget, DiffFile, FileItem, GapItem, LineCell, RowKind, RowRef, Side, ThreadLike, ViewMode } from "./diff-types.ts";

type PlainRow = LineRow | GapItem;

function span(lines: readonly HunkLine[]): { first: number; last: number } | null {
  const fresh = lines.flatMap((line) => (line.new === null ? [] : [line.new]));
  const numbers = fresh.length > 0 ? fresh : lines.flatMap((line) => (line.old === null ? [] : [line.old]));
  const first = numbers[0];
  const last = numbers[numbers.length - 1];
  return first === undefined || last === undefined ? null : { first, last };
}

/** Rows drawn straight from the compare body, before the two file versions are known: only the gaps between hunks have a size. */
function hunkRows(file: DiffFile): PlainRow[] {
  const rows: PlainRow[] = [];
  let previousLast = 0;
  file.hunks.forEach((hunk, index) => {
    const edge = span(hunk.lines);
    const hidden = edge === null ? 0 : edge.first - previousLast - 1;
    if (hidden > 0) rows.push({ kind: "gap", gap: index, hidden, canExpandAbove: true, canExpandBelow: index > 0 });
    for (const line of hunk.lines) rows.push({ kind: "line", ...line });
    if (edge !== null) previousLast = edge.last;
  });
  if (file.hunks.length > 0 && file.status !== "added" && file.status !== "deleted") {
    rows.push({ kind: "gap", gap: file.hunks.length, hidden: null, canExpandAbove: false, canExpandBelow: true });
  }
  return rows;
}

function cellOf(path: string, line: HunkLine, col: Column): LineCell {
  const kind: RowKind = line.type === "add" ? "added" : line.type === "del" ? "removed" : "unchanged";
  const side: Side = kind === "removed" ? "old" : "new";
  const n = side === "old" ? (line.old ?? 0) : (line.new ?? line.old ?? 0);
  return { path, col, kind, side, n, oldNumber: line.old, newNumber: line.new, text: line.text };
}

/** The rows of one file in the chosen view. `ops` is the whole-file diff once both versions are loaded. */
export function fileItems(file: DiffFile, ops: readonly DiffOp[] | null, expansion: Expansion, view: ViewMode): FileItem[] {
  const expanded = ops === null ? [] : expandedRows(ops, DEFAULT_CONTEXT, expansion);
  const rows: PlainRow[] = expanded.length > 0 ? expanded : hunkRows(file);
  if (view === "inline") {
    return rows.map((row): FileItem => (row.kind === "gap" ? row : { kind: "line", cell: cellOf(file.path, row, "i") }));
  }
  const items: FileItem[] = [];
  let run: LineRow[] = [];
  const flush = () => {
    for (const pair of splitRows(run)) {
      if (pair.kind !== "pair") continue;
      items.push({
        kind: "pair",
        left: pair.left === null ? null : cellOf(file.path, pair.left, "l"),
        right: pair.right === null ? null : cellOf(file.path, pair.right, "r"),
      });
    }
    run = [];
  };
  for (const row of rows) {
    if (row.kind === "gap") {
      flush();
      items.push(row);
    } else {
      run.push(row);
    }
  }
  flush();
  return items;
}

export function cellKey(cell: Pick<LineCell, "col" | "kind" | "n">): string {
  return `${cell.col}:${cell.kind}:${cell.n}`;
}

/** Names a row in the DOM (`data-key`) and in lookups; unique across the whole grid. */
export function rowId(row: Pick<LineCell, "path" | "col" | "kind" | "n">): string {
  return `${row.path}\u0000${cellKey(row)}`;
}

export function rowRefOf(cell: LineCell): RowRef {
  return { path: cell.path, kind: cell.kind, n: cell.n, col: cell.col };
}

export function sameRow(a: RowRef, b: RowRef): boolean {
  return a.path === b.path && a.kind === b.kind && a.n === b.n && a.col === b.col;
}

function unresolvedPhrase(count: number): string {
  return count === 1 ? "1 unresolved thread" : `${count} unresolved threads`;
}

export function rowLabel(cell: Pick<LineCell, "kind" | "n" | "path">, unresolved: number): string {
  const base = `Line ${cell.n} ${cell.kind}, ${cell.path}`;
  return unresolved > 0 ? `${base}, ${unresolvedPhrase(unresolved)}` : base;
}

// --- Threads -------------------------------------------------------------------------------------------------------------

export function anchorKey(path: string, side: Side, n: number): string {
  return `${path}\u0000${side}\u0000${n}`;
}

interface ThreadSpot {
  path: string;
  side: Side;
  start: number;
  end: number;
}

/** The start and end line a thread is labelled with: its line on the latest version, or where it was made when it is outdated. */
export function threadLines(thread: ThreadLike): { start: number; end: number | null } {
  const position = thread.position;
  if (position === null) return { start: 0, end: null };
  const made = position.new_line ?? position.old_line ?? 0;
  const start = thread.current_line ?? made;
  return { start, end: position.end_line === null ? null : start + (position.end_line - made) };
}

export function threadLabel(thread: ThreadLike, resolved: boolean = thread.resolved): string {
  const state = resolved ? "resolved" : "unresolved";
  const position = thread.position;
  if (position === null) return `Thread on merge request, ${state}`;
  const { start, end } = threadLines(thread);
  return `Thread on ${position.path} ${end === null ? `line ${start}` : `lines ${start}-${end}`}, ${state}`;
}

/** Where a thread belongs on the diff of versions `from`..`to`, or null when no row of that diff can hold it. */
function threadSpot(thread: ThreadLike, to: number, latest: number, fromTarget: boolean): ThreadSpot | null {
  const position = thread.position;
  if (position === null) return null;
  const side: Side = position.old_line !== null ? "old" : "new";
  const made = position.old_line ?? position.new_line ?? 0;
  const start = to === latest ? thread.current_line : position.version === to ? made : null;
  if (start === null || (side === "old" && !fromTarget)) return null;
  return { path: position.path, side, start, end: position.end_line === null ? start : start + (position.end_line - made) };
}

export interface Placement<T extends ThreadLike> {
  /** Threads under the row at an anchor (the end line of the thread). */
  byAnchor: ReadonlyMap<string, readonly T[]>;
  spots: ReadonlyMap<number, ThreadSpot>;
}

export function placeThreads<T extends ThreadLike>(threads: readonly T[], to: number, latest: number, fromTarget: boolean): Placement<T> {
  const byAnchor = new Map<string, T[]>();
  const spots = new Map<number, ThreadSpot>();
  for (const thread of threads) {
    const spot = threadSpot(thread, to, latest, fromTarget);
    if (spot === null) continue;
    spots.set(thread.id, spot);
    const key = anchorKey(spot.path, spot.side, spot.end);
    byAnchor.set(key, [...(byAnchor.get(key) ?? []), thread]);
  }
  return { byAnchor, spots };
}

export function cellAnchor(cell: LineCell): string {
  return anchorKey(cell.path, cell.side, cell.n);
}

/** In the side-by-side view the left cell of an unchanged line repeats the right one, so only the right one holds threads. */
export function holdsThreads(cell: LineCell): boolean {
  return !(cell.col === "l" && cell.kind === "unchanged");
}

// --- Range selection -----------------------------------------------------------------------------------------------------

export interface Selection {
  path: string;
  side: Side;
  anchor: number;
  head: number;
}

export function selectionRange(selection: Selection): { start: number; end: number | null } {
  const start = Math.min(selection.anchor, selection.head);
  const end = Math.max(selection.anchor, selection.head);
  return { start, end: end === start ? null : end };
}

/** Moves the free end of the selection one line, only onto a line that is drawn and keeps the range contiguous. */
export function stepSelection(selection: Selection, direction: 1 | -1, drawn: (n: number) => boolean): Selection {
  const next = selection.head + direction;
  return next >= 1 && drawn(next) ? { ...selection, head: next } : selection;
}

export function targetFrom(selection: Selection, version: number, row: RowRef): CommentTarget {
  const { start, end } = selectionRange(selection);
  return { path: selection.path, side: selection.side, start, end, version, row };
}
