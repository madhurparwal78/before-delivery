import type { Cell, CellType, Checkpoint, CompareResult, KernelStatus, Present, Role } from "../../shared/api";

/** Unsaved text for a cell, with the revision the page last received before editing began. */
export interface Draft {
  source: string;
  cell_type: CellType;
  base: number;
}

export interface CellModel {
  server: Cell;
  draft: Draft | null;
}

export type Dialog =
  | { kind: "restart" }
  | { kind: "conflict"; stale: Cell[]; cellId: string }
  | { kind: "revert"; checkpoint: Checkpoint; cellId: string | null }
  | { kind: "share" }
  | { kind: "palette" }
  | { kind: "sheet"; cellId: string }
  | { kind: "drawer" };

export interface Meta {
  id: string;
  title: string;
  role: Role;
  owner_display_name: string;
  imported: boolean;
  execution_counter: number;
}

export interface Comparison {
  checkpoint: Checkpoint;
  result: CompareResult;
}

/** A polite announcement; `n` changes with every message so a repeat is announced again. */
export interface Announcement {
  text: string;
  n: number;
}

export interface NotebookState {
  phase: "loading" | "ready" | "notfound" | "failed";
  meta: Meta | null;
  cells: CellModel[];
  cursor: string | null;
  anchor: string | null;
  mode: "command" | "edit";
  kernel: KernelStatus;
  reconnecting: boolean;
  present: Present[];
  status: Announcement;
  saveStatus: string;
  outage: boolean;
  dialog: Dialog | null;
  panelOpen: boolean;
  checkpoints: Checkpoint[];
  comparison: Comparison | null;
  /** Cells this tab holds the edit lock on. */
  locks: ReadonlySet<string>;
  /** Asks the view to put keyboard focus on the cursor cell. */
  focusToken: number;
  /** The cell the last move or insert acted on, so the view can animate it. */
  moved: string | null;
}

export const shownSource = (cell: CellModel): string => cell.draft?.source ?? cell.server.source;
export const shownType = (cell: CellModel): CellType => cell.draft?.cell_type ?? cell.server.cell_type;
