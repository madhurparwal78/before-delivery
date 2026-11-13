// Shapes of the diff screen: the compare body from `GET …/merge_requests/<iid>/diff`, the rows drawn from it and the places a
// comment can go.
import type { HunkLine } from "../../../shared/diff.ts";

export type FileStatus = "added" | "modified" | "deleted" | "moved";
export type ViewMode = "inline" | "split";
export type Side = "old" | "new";
export type RowKind = "added" | "removed" | "unchanged";
// `i` is the inline row; `l` and `r` are the left and right cells of the side-by-side view.
export type Column = "i" | "l" | "r";

export interface DiffHunk {
  header: string;
  lines: readonly HunkLine[];
}

export interface DiffFile {
  path: string;
  old_path: string | null;
  status: FileStatus;
  hunks: DiffHunk[];
}

export interface DiffBody {
  merge_base: string | null;
  diffs: DiffFile[];
}

export interface LineCell {
  path: string;
  col: Column;
  kind: RowKind;
  side: Side;
  /** The number shown in the row label: the new-side number, or the old-side number for a removed line. */
  n: number;
  oldNumber: number | null;
  newNumber: number | null;
  text: string;
}

export interface GapItem {
  kind: "gap";
  gap: number;
  /** Lines still hidden; null while the length of the file is not known yet. */
  hidden: number | null;
  canExpandAbove: boolean;
  canExpandBelow: boolean;
}

interface LineItem {
  kind: "line";
  cell: LineCell;
}

interface PairItem {
  kind: "pair";
  left: LineCell | null;
  right: LineCell | null;
}

export type FileItem = LineItem | PairItem | GapItem;

/** The row that holds the roving focus and anchors keyboard actions. */
export interface RowRef {
  path: string;
  kind: RowKind;
  n: number;
  col: Column;
}

/** Where a new comment goes: one line or a range on one side of one file. */
export interface CommentTarget {
  path: string;
  side: Side;
  start: number;
  /** Last line of a range; null for a single line. */
  end: number | null;
  /** Version the line numbers belong to. */
  version: number;
  /** The row focus returns to. */
  row: RowRef;
}

export function targetLabel(target: Pick<CommentTarget, "start" | "end">): string {
  return target.end === null ? `Comment on line ${target.start}` : `Comment on lines ${target.start}-${target.end}`;
}

/** What the diff needs to know of a thread; the page's ThreadView has all of it. */
export interface ThreadLike {
  id: number;
  position: { path: string; old_line: number | null; new_line: number | null; end_line: number | null; version: number } | null;
  current_line: number | null;
  resolved: boolean;
}
