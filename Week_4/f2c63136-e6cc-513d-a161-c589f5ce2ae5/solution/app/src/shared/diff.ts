// The line diff (brief: The line diff). Shared so the server's diff route and its thread
// mapping are the same code; the browser only renders what the server sends.

type RowKind = 'hunk' | 'context' | 'added' | 'removed';

interface DiffRow {
  kind: RowKind;
  old_line: number | null;
  new_line: number | null;
  text: string;
}

interface Hunk {
  header: string;
  rows: DiffRow[];
}

/** A line is text ended by a newline; a missing last newline adds no marker row, an empty file has no lines. */
export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

type Op = { op: 'eq' | 'del' | 'add'; oldIndex: number; newIndex: number };

/**
 * Minimal line diff. Among equally minimal diffs it keeps the earliest matching lines of the old
 * file and, for those old lines, the earliest matching lines of the new file; inside one run of
 * changes every removed line comes before every added line.
 */
function editScript(a: string[], b: string[]): Op[] {
  const ops: Op[] = [];
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    ops.push({ op: 'eq', oldIndex: start, newIndex: start });
    start += 1;
  }
  const n = a.length - start;
  const m = b.length - start;
  const width = m + 1;
  const table = new Uint32Array((n + 1) * width);
  for (let i = n - 1; i >= 0; i -= 1) {
    for (let j = m - 1; j >= 0; j -= 1) {
      table[i * width + j] =
        a[start + i] === b[start + j]
          ? table[(i + 1) * width + j + 1] + 1
          : Math.max(table[(i + 1) * width + j], table[i * width + j + 1]);
    }
  }
  let removed: number[] = [];
  let added: number[] = [];
  const flush = () => {
    for (const index of removed) ops.push({ op: 'del', oldIndex: start + index, newIndex: -1 });
    for (const index of added) ops.push({ op: 'add', oldIndex: -1, newIndex: start + index });
    removed = [];
    added = [];
  };
  let i = 0;
  let j = 0;
  while (i < n && table[i * width + j] > 0) {
    let match = -1;
    for (let k = j; k < m; k += 1) {
      if (a[start + i] === b[start + k] && table[i * width + j] === table[(i + 1) * width + k + 1] + 1) {
        match = k;
        break;
      }
    }
    if (match < 0) {
      removed.push(i);
      i += 1;
      continue;
    }
    for (let k = j; k < match; k += 1) added.push(k);
    flush();
    ops.push({ op: 'eq', oldIndex: start + i, newIndex: start + match });
    i += 1;
    j = match + 1;
  }
  for (; i < n; i += 1) removed.push(i);
  for (; j < m; j += 1) added.push(j);
  flush();
  return ops;
}

/** For every old line, the new line number it became (1-based), or null when it changed or went. */
export function mapLines(oldText: string, newText: string): (number | null)[] {
  const oldLines = splitLines(oldText);
  const mapped: (number | null)[] = oldLines.map(() => null);
  for (const step of editScript(oldLines, splitLines(newText))) {
    if (step.op === 'eq') mapped[step.oldIndex] = step.newIndex + 1;
  }
  return mapped;
}

export function diffHunks(oldText: string, newText: string, context: number): Hunk[] {
  const oldLines = splitLines(oldText);
  const newLines = splitLines(newText);
  const rows: DiffRow[] = editScript(oldLines, newLines).map((step) => {
    if (step.op === 'eq') return { kind: 'context', old_line: step.oldIndex + 1, new_line: step.newIndex + 1, text: oldLines[step.oldIndex] };
    if (step.op === 'del') return { kind: 'removed', old_line: step.oldIndex + 1, new_line: null, text: oldLines[step.oldIndex] };
    return { kind: 'added', old_line: null, new_line: step.newIndex + 1, text: newLines[step.newIndex] };
  });
  const ranges: [number, number][] = [];
  rows.forEach((row, index) => {
    if (row.kind === 'context') return;
    const from = Math.max(0, index - context);
    const to = Math.min(rows.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last && from <= last[1] + 1) last[1] = Math.max(last[1], to);
    else ranges.push([from, to]);
  });
  return ranges.map(([from, to]) => {
    const body = rows.slice(from, to + 1);
    const before = rows.slice(0, from);
    const oldCount = body.filter((row) => row.old_line !== null).length;
    const newCount = body.filter((row) => row.new_line !== null).length;
    const oldStart = before.filter((row) => row.old_line !== null).length + (oldCount ? 1 : 0);
    const newStart = before.filter((row) => row.new_line !== null).length + (newCount ? 1 : 0);
    const header = `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
    return { header, rows: [{ kind: 'hunk', old_line: null, new_line: null, text: header }, ...body] };
  });
}
