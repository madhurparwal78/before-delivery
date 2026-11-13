import type { Cell, CompareResult, CompareRow, CompareTag, DiffLine } from './types.js';

const MAX_DIFF_CELLS = 4_000_000;

/**
 * The line diff of two sources. The `same` lines are a longest common
 * subsequence; each checkpoint line, earliest first, is matched to the earliest
 * current line that still allows a longest one, and every removed line in a gap
 * comes before every added line.
 */
function lineDiff(checkpointSource: string, currentSource: string): DiffLine[] {
  const before = checkpointSource.split('\n');
  const after = currentSource.split('\n');
  const n = before.length;
  const m = after.length;
  if ((n + 1) * (m + 1) > MAX_DIFF_CELLS) {
    return [
      ...before.map((line): DiffLine => ({ op: 'removed', line })),
      ...after.map((line): DiffLine => ({ op: 'added', line })),
    ];
  }
  const width = m + 1;
  const lengths = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lengths[i * width + j] =
        before[i] === after[j]
          ? lengths[(i + 1) * width + (j + 1)] + 1
          : Math.max(lengths[(i + 1) * width + j], lengths[i * width + (j + 1)]);
    }
  }
  const diff: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (before[i] === after[j] && lengths[i * width + j] === lengths[(i + 1) * width + (j + 1)] + 1) {
      diff.push({ op: 'same', line: before[i] });
      i += 1;
      j += 1;
    } else if (lengths[(i + 1) * width + j] >= lengths[i * width + (j + 1)]) {
      diff.push({ op: 'removed', line: before[i] });
      i += 1;
    } else {
      diff.push({ op: 'added', line: after[j] });
      j += 1;
    }
  }
  while (i < n) {
    diff.push({ op: 'removed', line: before[i] });
    i += 1;
  }
  while (j < m) {
    diff.push({ op: 'added', line: after[j] });
    j += 1;
  }
  return diff;
}

/**
 * The indices of the longest run of values that keep their relative order.
 * Ties pick the run whose values are earliest.
 */
function longestOrderedRun(values: number[]): Set<number> {
  const tails: number[] = [];
  const tailIndex: number[] = [];
  const previous = new Array<number>(values.length).fill(-1);
  for (let i = 0; i < values.length; i += 1) {
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (tails[middle] < values[i]) low = middle + 1;
      else high = middle;
    }
    tails[low] = values[i];
    tailIndex[low] = i;
    previous[i] = low > 0 ? tailIndex[low - 1] : -1;
  }
  const run = new Set<number>();
  let cursor = tails.length > 0 ? tailIndex[tails.length - 1] : -1;
  while (cursor >= 0) {
    run.add(cursor);
    cursor = previous[cursor];
  }
  return run;
}

function sameOutputs(left: Cell, right: Cell): boolean {
  return JSON.stringify(left.outputs) === JSON.stringify(right.outputs);
}

/**
 * Compares a checkpoint's cells with the current cells, pairing cells by id.
 * This is the one place the compare tags and counts are decided.
 */
export function compareCells(checkpointCells: Cell[], currentCells: Cell[]): CompareResult {
  const checkpointById = new Map(checkpointCells.map((cell) => [cell.id, cell]));
  const currentById = new Map(currentCells.map((cell) => [cell.id, cell]));
  const currentPosition = new Map(currentCells.map((cell, index) => [cell.id, index]));

  const sharedInCheckpointOrder = checkpointCells.filter((cell) => currentById.has(cell.id));
  const orderedRun = longestOrderedRun(
    sharedInCheckpointOrder.map((cell) => currentPosition.get(cell.id) as number),
  );
  const movedIds = new Set<string>();
  sharedInCheckpointOrder.forEach((cell, index) => {
    if (!orderedRun.has(index)) movedIds.add(cell.id);
  });

  const tagOf = (id: string): CompareTag => {
    const checkpointCell = checkpointById.get(id);
    const currentCell = currentById.get(id);
    if (!checkpointCell) return 'Added';
    if (!currentCell) return 'Removed';
    if (checkpointCell.source !== currentCell.source || checkpointCell.cell_type !== currentCell.cell_type) {
      return 'Modified';
    }
    return movedIds.has(id) ? 'Moved' : 'Unchanged';
  };

  const removedAfter = new Map<string | null, Cell[]>();
  for (let index = 0; index < checkpointCells.length; index += 1) {
    const cell = checkpointCells[index];
    if (currentById.has(cell.id)) continue;
    let anchor: string | null = null;
    for (let above = index - 1; above >= 0; above -= 1) {
      if (currentById.has(checkpointCells[above].id)) {
        anchor = checkpointCells[above].id;
        break;
      }
    }
    const bucket = removedAfter.get(anchor);
    if (bucket) bucket.push(cell);
    else removedAfter.set(anchor, [cell]);
  }

  const rows: CompareRow[] = [];
  const pushRow = (checkpointCell: Cell | null, currentCell: Cell | null): void => {
    const id = (currentCell ?? checkpointCell) as Cell;
    const tag = tagOf(id.id);
    rows.push({
      tag,
      checkpoint_cell: checkpointCell,
      current_cell: currentCell,
      source_diff:
        tag === 'Modified' && checkpointCell && currentCell
          ? lineDiff(checkpointCell.source, currentCell.source)
          : [],
      output_changed: Boolean(checkpointCell && currentCell && !sameOutputs(checkpointCell, currentCell)),
    });
  };

  for (const cell of removedAfter.get(null) ?? []) pushRow(cell, null);
  for (const cell of currentCells) {
    pushRow(checkpointById.get(cell.id) ?? null, cell);
    for (const removed of removedAfter.get(cell.id) ?? []) pushRow(removed, null);
  }

  const counts = { modified: 0, added: 0, removed: 0, moved: 0 };
  for (const row of rows) {
    if (row.tag === 'Modified') counts.modified += 1;
    else if (row.tag === 'Added') counts.added += 1;
    else if (row.tag === 'Removed') counts.removed += 1;
    else if (row.tag === 'Moved') counts.moved += 1;
  }
  return { counts, rows };
}

export function compareHeading(counts: CompareResult['counts']): string {
  return `${counts.modified} modified, ${counts.added} added, ${counts.removed} removed, ${counts.moved} moved`;
}
