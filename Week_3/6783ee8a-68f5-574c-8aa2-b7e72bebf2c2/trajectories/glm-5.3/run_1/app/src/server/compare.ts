import type { Cell, CompareResult, CompareRow, CompareTag, DiffOp } from "../shared/types.ts";

function lcsTable(a: string[], b: string[]): number[][] {
  const rows = a.length;
  const cols = b.length;
  const table: number[][] = Array.from({ length: rows + 1 }, () => new Array<number>(cols + 1).fill(0));
  for (let i = rows - 1; i >= 0; i--) {
    for (let j = cols - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

/**
 * Line diff in one place: `same` lines are a longest common subsequence matched earliest-first;
 * between them, checkpoint lines are `removed` before current lines are `added`, each in order.
 */
export function diffLines(checkpointSource: string, currentSource: string): DiffOp[] {
  const a = checkpointSource.split("\n");
  const b = currentSource.split("\n");
  const table = lcsTable(a, b);
  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j] && table[i][j] === table[i + 1][j + 1] + 1) {
      ops.push({ op: "same", line: a[i] });
      i += 1;
      j += 1;
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      ops.push({ op: "removed", line: a[i] });
      i += 1;
    } else {
      ops.push({ op: "added", line: b[j] });
      j += 1;
    }
  }
  while (i < a.length) {
    ops.push({ op: "removed", line: a[i] });
    i += 1;
  }
  while (j < b.length) {
    ops.push({ op: "added", line: b[j] });
    j += 1;
  }
  return groupRuns(ops);
}

function groupRuns(ops: DiffOp[]): DiffOp[] {
  const grouped: DiffOp[] = [];
  let pendingRemoved: DiffOp[] = [];
  let pendingAdded: DiffOp[] = [];
  const flush = () => {
    grouped.push(...pendingRemoved, ...pendingAdded);
    pendingRemoved = [];
    pendingAdded = [];
  };
  for (const op of ops) {
    if (op.op === "same") {
      flush();
      grouped.push(op);
    } else if (op.op === "removed") {
      pendingRemoved.push(op);
    } else {
      pendingAdded.push(op);
    }
  }
  flush();
  return grouped;
}

/** Compare tagging in one place. */
export function compareNotebooks(checkpointCells: Cell[], currentCells: Cell[]): CompareResult {
  const checkpointById = new Map(checkpointCells.map((cell) => [cell.id, cell]));
  const currentById = new Map(currentCells.map((cell) => [cell.id, cell]));
  const counts = { modified: 0, added: 0, removed: 0, moved: 0 };
  const tags = new Map<string, CompareTag>();
  for (const cell of currentCells) {
    const old = checkpointById.get(cell.id);
    if (old === undefined) {
      tags.set(cell.id, "Added");
      counts.added += 1;
    } else if (old.source !== cell.source || old.cell_type !== cell.cell_type) {
      tags.set(cell.id, "Modified");
      counts.modified += 1;
    } else if (isMoved(cell.id, checkpointCells, currentCells)) {
      tags.set(cell.id, "Moved");
      counts.moved += 1;
    } else {
      tags.set(cell.id, "Unchanged");
    }
  }
  const removedIds: string[] = [];
  for (const cell of checkpointCells) {
    if (!currentById.has(cell.id)) removedIds.push(cell.id);
  }
  counts.removed = removedIds.length;

  // Rows follow the current notebook's order; a removed row sits after the nearest kept cell above it.
  const rows: CompareRow[] = [];
  const removedQueue = [...removedIds];
  for (const cell of currentCells) {
    placeRemovedRows(rows, removedQueue, checkpointById, cell.id);
    rows.push(rowFor(tags.get(cell.id) ?? "Unchanged", checkpointById.get(cell.id) ?? null, cell));
  }
  placeRemovedRows(rows, removedQueue, checkpointById, null);
  return { counts, rows };
}

function placeRemovedRows(
  rows: CompareRow[],
  removedQueue: string[],
  checkpointById: Map<string, Cell>,
  nextCurrentId: string | null,
): void {
  while (removedQueue.length > 0) {
    const candidate = checkpointById.get(removedQueue[0]);
    if (candidate === undefined) {
      removedQueue.shift();
      continue;
    }
    if (nextCurrentId !== null) {
      const next = checkpointById.get(nextCurrentId);
      if (next === undefined || candidate.position >= next.position) break;
    }
    rows.push(rowFor("Removed", candidate, null));
    removedQueue.shift();
  }
}

function rowFor(tag: CompareTag, checkpointCell: Cell | null, currentCell: Cell | null): CompareRow {
  const source_diff =
    tag === "Modified" && checkpointCell !== null && currentCell !== null
      ? diffLines(checkpointCell.source, currentCell.source)
      : [];
  const output_changed =
    checkpointCell !== null && currentCell !== null
      ? JSON.stringify(checkpointCell.outputs) !== JSON.stringify(currentCell.outputs)
      : false;
  return { tag, checkpoint_cell: checkpointCell, current_cell: currentCell, source_diff, output_changed };
}

/** The longest run of shared ids that keep their relative order, preferring earlier current positions on ties. */
export function isMoved(cellId: string, checkpointCells: Cell[], currentCells: Cell[]): boolean {
  const sharedIds = currentCells.filter((c) => checkpointCells.some((k) => k.id === c.id)).map((c) => c.id);
  const positions = new Map(sharedIds.map((id, index) => [id, index]));
  const checkpointShared = checkpointCells.filter((c) => positions.has(c.id)).map((c) => c.id);
  const target = [...checkpointShared].sort((a, b) => (positions.get(a) ?? 0) - (positions.get(b) ?? 0));
  const longest = longestIncreasingRun(target);
  return !longest.has(cellId);
}

function longestIncreasingRun(ids: string[]): Set<string> {
  // Longest strictly increasing subsequence by current position.
  const values = ids.map((id) => id);
  const n = values.length;
  if (n === 0) return new Set();
  const lengths = new Array<number>(n).fill(1);
  const prev = new Array<number>(n).fill(-1);
  let bestEnd = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (lengths[j] + 1 > lengths[i]) {
        lengths[i] = lengths[j] + 1;
        prev[i] = j;
      }
    }
    if (lengths[i] > lengths[bestEnd]) bestEnd = i;
  }
  const run = new Set<string>();
  let current = bestEnd;
  while (current !== -1) {
    run.add(values[current]);
    current = prev[current];
  }
  return run;
}
