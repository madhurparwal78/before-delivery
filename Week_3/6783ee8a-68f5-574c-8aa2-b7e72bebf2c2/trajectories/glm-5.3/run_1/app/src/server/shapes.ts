import type { Cell, KernelStatus, Notebook, Output, Role, RunState, CellType } from "../shared/types.ts";

export type CellRow = {
  id: string;
  position: number;
  cell_type: CellType;
  source: string;
  revision: number;
  execution_count: number | null;
  run_state: RunState;
  outputs: Output[];
  outputs_version: number;
  metadata: Record<string, unknown>;
  locked_by: string | null;
};

type RawCell = {
  id: string;
  position: number;
  cell_type: string;
  source: string;
  revision: number;
  execution_count: number | null;
  run_state: string;
  outputs: unknown;
  outputs_version: number;
  metadata: unknown;
  locked_by: string | null;
};

export function toCell(raw: RawCell): Cell {
  return {
    id: raw.id,
    position: raw.position,
    cell_type: raw.cell_type === "markdown" ? "markdown" : "code",
    source: raw.source,
    revision: raw.revision,
    execution_count: raw.execution_count,
    run_state: raw.run_state as RunState,
    outputs: (raw.outputs ?? []) as Output[],
    outputs_version: raw.outputs_version,
    metadata: (raw.metadata ?? {}) as Record<string, unknown>,
    locked_by: raw.locked_by,
  };
}

export type NotebookRow = {
  id: string;
  title: string;
  role: Role;
  owner_display_name: string;
  imported: boolean;
  execution_counter: number;
  kernel_status: KernelStatus;
  cells: Cell[];
};

export function toNotebook(row: NotebookRow): Notebook {
  return { ...row };
}

/** A checkpoint snapshot or working copy, in the published export format. */
export type NotebookSnapshot = {
  nbformat: 4;
  nbformat_minor: 5;
  metadata: Record<string, unknown>;
  cells: {
    id: string;
    cell_type: CellType;
    source: string;
    metadata: Record<string, unknown>;
    execution_count?: number | null;
    outputs?: Output[];
  }[];
};

export function snapshotFromCells(cells: CellRow[], metadata: Record<string, unknown> = {}): NotebookSnapshot {
  return {
    nbformat: 4,
    nbformat_minor: 5,
    metadata,
    cells: cells.map((cell) => ({
      id: cell.id,
      cell_type: cell.cell_type,
      source: cell.source,
      metadata: cell.metadata,
      ...(cell.cell_type === "code" ? { execution_count: cell.execution_count, outputs: cell.outputs } : {}),
    })),
  };
}

export function outputsEqual(a: Output[], b: Output[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
