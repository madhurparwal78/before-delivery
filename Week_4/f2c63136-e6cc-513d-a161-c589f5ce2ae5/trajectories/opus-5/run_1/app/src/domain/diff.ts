import { config } from '../server/config.js';

export type RowKind = 'hunk' | 'context' | 'added' | 'removed';

export interface DiffRow {
  kind: RowKind;
  old_line: number | null;
  new_line: number | null;
  text: string;
}

export interface Hunk {
  header: string;
  rows: DiffRow[];
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type Op = { type: 'eq' | 'del' | 'add'; oldLine: number; newLine: number; text: string };

/**
 * Minimal line diff. Matches are taken as early as possible in the old file and,
 * for the same old lines, as early as possible in the new file.
 */
function diffOps(oldLines: string[], newLines: string[]): Op[] {
  const n = oldLines.length;
  const m = newLines.length;
  const width = m + 1;
  const lcs = new Int32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      lcs[i * width + j] =
        oldLines[i] === newLines[j]
          ? lcs[(i + 1) * width + j + 1] + 1
          : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    }
  }

  const ops: Op[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && oldLines[i] === newLines[j] && lcs[i * width + j] === lcs[(i + 1) * width + j + 1] + 1) {
      ops.push({ type: 'eq', oldLine: i + 1, newLine: j + 1, text: oldLines[i] });
      i += 1;
      j += 1;
    } else if (j < m && (i >= n || lcs[i * width + j + 1] >= lcs[(i + 1) * width + j])) {
      ops.push({ type: 'add', oldLine: 0, newLine: j + 1, text: newLines[j] });
      j += 1;
    } else {
      ops.push({ type: 'del', oldLine: i + 1, newLine: 0, text: oldLines[i] });
      i += 1;
    }
  }
  return ops;
}

function orderedRows(ops: Op[]): DiffRow[] {
  const rows: DiffRow[] = [];
  let index = 0;
  while (index < ops.length) {
    const op = ops[index];
    if (op.type === 'eq') {
      rows.push({ kind: 'context', old_line: op.oldLine, new_line: op.newLine, text: op.text });
      index += 1;
      continue;
    }
    const run: Op[] = [];
    while (index < ops.length && ops[index].type !== 'eq') {
      run.push(ops[index]);
      index += 1;
    }
    for (const entry of run) {
      if (entry.type === 'del') rows.push({ kind: 'removed', old_line: entry.oldLine, new_line: null, text: entry.text });
    }
    for (const entry of run) {
      if (entry.type === 'add') rows.push({ kind: 'added', old_line: null, new_line: entry.newLine, text: entry.text });
    }
  }
  return rows;
}

export function diffHunks(baseText: string, headText: string): Hunk[] {
  const oldLines = splitLines(baseText);
  const newLines = splitLines(headText);
  const rows = orderedRows(diffOps(oldLines, newLines));
  const context = config.diffContextLines;

  const changedIndexes: number[] = [];
  rows.forEach((row, index) => {
    if (row.kind !== 'context') changedIndexes.push(index);
  });
  if (changedIndexes.length === 0) return [];

  const groups: Array<{ first: number; last: number }> = [];
  for (const index of changedIndexes) {
    const current = groups[groups.length - 1];
    if (current && index - current.last - 1 <= context * 2) {
      current.last = index;
    } else {
      groups.push({ first: index, last: index });
    }
  }

  const oldBefore: number[] = [];
  const newBefore: number[] = [];
  let oldCount = 0;
  let newCount = 0;
  for (const row of rows) {
    oldBefore.push(oldCount);
    newBefore.push(newCount);
    if (row.old_line !== null) oldCount += 1;
    if (row.new_line !== null) newCount += 1;
  }

  return groups.map((group) => {
    const start = Math.max(0, group.first - context);
    const end = Math.min(rows.length - 1, group.last + context);
    const slice = rows.slice(start, end + 1);
    const oldLinesInHunk = slice.filter((row) => row.old_line !== null);
    const newLinesInHunk = slice.filter((row) => row.new_line !== null);
    const oldStart = oldLinesInHunk.length > 0 ? oldLinesInHunk[0].old_line! : oldBefore[start];
    const newStart = newLinesInHunk.length > 0 ? newLinesInHunk[0].new_line! : newBefore[start];
    const header = `@@ -${oldStart},${oldLinesInHunk.length} +${newStart},${newLinesInHunk.length} @@`;
    return { header, rows: slice };
  });
}

/** Maps a line number of the old text to its line number in the new text, or null when it changed. */
export function lineMapping(baseText: string, headText: string): Map<number, number> {
  const ops = diffOps(splitLines(baseText), splitLines(headText));
  const map = new Map<number, number>();
  for (const op of ops) {
    if (op.type === 'eq') map.set(op.oldLine, op.newLine);
  }
  return map;
}
