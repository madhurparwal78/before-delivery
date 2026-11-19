/**
 * Lines are runs of text ended by a newline byte; a trailing \r stays part of
 * the line. A file with no final newline simply has fewer lines.
 */
export function splitLines(text: string): string[] {
  const lines: string[] = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      lines.push(text.slice(start, i));
      start = i + 1;
    }
  }
  if (start < text.length) lines.push(text.slice(start));
  return lines;
}

export type RowKind = 'hunk' | 'context' | 'added' | 'removed';

export interface DiffRow {
  kind: RowKind;
  old_line: number | null;
  new_line: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  rows: DiffRow[];
}

export interface FileDiff {
  status: 'added' | 'modified' | 'deleted';
  hunks: DiffHunk[];
}

export interface EmitRow {
  kind: 'context' | 'removed' | 'added';
  oldLine: number | null; // zero-based old index, null when not on that side
  newLine: number | null; // zero-based new index
  oldPos: number; // old lines consumed before this row
  newPos: number; // new lines consumed before this row
  text: string;
}

const DP_CELL_BUDGET = 2_000_000;

/**
 * Minimal line diff with the published tie-break: among equally minimal diffs
 * keep the earliest matching lines of the old file and, for the same old
 * lines, the earliest matching lines of the new file. Prefix trimming is
 * always part of the preferred solution; the remaining middle range is solved
 * with a suffix DP that prefers taking a match.
 */
function matchPairs(oldLines: string[], newLines: string[]): Array<{ old: number; new: number }> {
  let prefix = 0;
  const n = oldLines.length, m = newLines.length;
  while (prefix < n && prefix < m && oldLines[prefix] === newLines[prefix]) prefix++;
  const o = oldLines.slice(prefix);
  const nw = newLines.slice(prefix);
  const out: Array<{ old: number; new: number }> = [];
  for (let i = 0; i < prefix; i++) out.push({ old: i, new: i });
  if (o.length === 0 || nw.length === 0) return out;
  if ((o.length + 1) * (nw.length + 1) > DP_CELL_BUDGET) {
    return out.concat(matchPairsAnchored(oldLines, newLines, prefix));
  }
  const on = o.length, nm = nw.length;
  const width = nm + 1;
  const cost = new Int32Array((on + 1) * width);
  const take = new Uint8Array((on + 1) * width);
  for (let i = on; i >= 0; i--) {
    for (let j = nm; j >= 0; j--) {
      const cur = i * width + j;
      if (i === on && j === nm) { cost[cur] = 0; take[cur] = 0; continue; }
      let best = -1; let bestTake = 0;
      if (i < on && j < nm && o[i] === nw[j]) {
        best = cost[cur + width + 1]; bestTake = 1;
      }
      if (i < on) {
        const c = 1 + cost[cur + width];
        if (best < 0 || c < best) { best = c; bestTake = 0; }
      }
      if (j < nm) {
        const c = 1 + cost[cur + 1];
        if (best < 0 || c < best) { best = c; bestTake = 0; }
      }
      cost[cur] = best; take[cur] = bestTake;
    }
  }
  let i = 0, j = 0;
  while (i < on || j < nm) {
    const cur = i * width + j;
    if (i < on && j < nm && take[cur]) {
      out.push({ old: prefix + i, new: prefix + j });
      i++; j++;
    } else if (i < on && (j === nm || 1 + cost[cur + width] <= 1 + cost[cur + 1])) {
      i++;
    } else {
      j++;
    }
  }
  return out;
}

/** Anchor split for very large files: unique lines pin the diff, gaps recurse. */
function matchPairsAnchored(oldLines: string[], newLines: string[], prefix: number): Array<{ old: number; new: number }> {
  const out: Array<{ old: number; new: number }> = [];
  const a = oldLines.slice(prefix);
  const b = newLines.slice(prefix);
  const countA = new Map<string, number>();
  const countB = new Map<string, number>();
  for (const l of a) countA.set(l, (countA.get(l) ?? 0) + 1);
  for (const l of b) countB.set(l, (countB.get(l) ?? 0) + 1);
  let ai = 0, bi = 0;
  while (ai < a.length && bi < b.length) {
    let found: { old: number; new: number } | null = null;
    for (let x = ai; x < a.length && !found; x++) {
      const line = a[x];
      if (countA.get(line) !== 1 || countB.get(line) !== 1) continue;
      for (let y = bi; y < b.length; y++) {
        if (b[y] === line) { found = { old: x, new: y }; break; }
      }
    }
    if (!found) break;
    const gapPairs = matchPairs(a.slice(ai, found.old), b.slice(bi, found.new));
    for (const p of gapPairs) out.push({ old: prefix + ai + p.old, new: prefix + bi + p.new });
    out.push({ old: prefix + found.old, new: prefix + found.new });
    ai = found.old + 1; bi = found.new + 1;
  }
  const tailPairs = matchPairs(a.slice(ai), b.slice(bi));
  for (const p of tailPairs) out.push({ old: prefix + ai + p.old, new: prefix + bi + p.new });
  return out;
}

/** Unified row list for one file, zero-based line indices, insertion positions. */
function buildEmitRows(oldText: string | null, newText: string | null): { rows: EmitRow[]; status: FileDiff['status'] } {
  const oldLines = oldText === null ? [] : splitLines(oldText);
  const newLines = newText === null ? [] : splitLines(newText);
  const status: FileDiff['status'] = oldText === null ? 'added' : newText === null ? 'deleted' : 'modified';
  const pairs = matchPairs(oldLines, newLines);
  const rows: EmitRow[] = [];
  let oi = 0, ni = 0, k = 0;
  const pushRun = (removedCount: number, addedCount: number) => {
    for (let x = 0; x < removedCount; x++) {
      rows.push({ kind: 'removed', oldLine: oi, newLine: null, oldPos: oi, newPos: ni, text: oldLines[oi] });
      oi++;
    }
    for (let x = 0; x < addedCount; x++) {
      rows.push({ kind: 'added', oldLine: null, newLine: ni, oldPos: oi, newPos: ni, text: newLines[ni] });
      ni++;
    }
  };
  while (oi < oldLines.length || ni < newLines.length) {
    if (k < pairs.length && pairs[k].old === oi && pairs[k].new === ni) {
      rows.push({ kind: 'context', oldLine: oi, newLine: ni, oldPos: oi, newPos: ni, text: oldLines[oi] });
      oi++; ni++; k++;
    } else if (k < pairs.length) {
      pushRun(pairs[k].old - oi, pairs[k].new - ni);
    } else {
      pushRun(oldLines.length - oi, newLines.length - ni);
    }
  }
  return { rows, status };
}

/** Groups rows into hunks with the given context; touching contexts merge. */
export function buildHunks(rows: EmitRow[], contextLines: number): DiffHunk[] {
  const keep = new Set<number>();
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind === 'context') continue;
    for (let c = 0; c <= contextLines; c++) {
      if (i - c >= 0) keep.add(i - c);
      if (i + c < rows.length) keep.add(i + c);
    }
  }
  const wanted = [...keep].sort((a, b) => a - b);
  const hunks: DiffHunk[] = [];
  let i = 0;
  while (i < wanted.length) {
    let j = i;
    while (j + 1 < wanted.length && wanted[j + 1] === wanted[j] + 1) j++;
    const slice = wanted.slice(i, j + 1).map((x) => rows[x]);
    let oldCount = 0, newCount = 0;
    for (const r of slice) {
      if (r.oldLine !== null) oldCount++;
      if (r.newLine !== null) newCount++;
    }
    const first = slice[0];
    const anyOld = slice.find((r) => r.oldLine !== null);
    const anyNew = slice.find((r) => r.newLine !== null);
    const oldStart = anyOld ? (anyOld.oldLine as number) + 1 : first.oldPos;
    const newStart = anyNew ? (anyNew.newLine as number) + 1 : first.newPos;
    hunks.push({
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      rows: slice.map((r) => ({
        kind: r.kind,
        old_line: r.oldLine === null ? null : r.oldLine + 1,
        new_line: r.newLine === null ? null : r.newLine + 1,
        text: r.text,
      })),
    });
    i = j + 1;
  }
  return hunks;
}

/** The full line diff of one file with context hunks. */
export function diffFile(oldText: string | null, newText: string | null, contextLines: number): FileDiff {
  const { rows, status } = buildEmitRows(oldText, newText);
  return { status, hunks: buildHunks(rows, contextLines) };
}

/** The combined row list (no hunk grouping) used for line mapping. */
export function diffRowsOf(oldText: string | null, newText: string | null): EmitRow[] {
  return buildEmitRows(oldText, newText).rows;
}

/**
 * Line movement between two texts of one side: for each one-based line number
 * of the previous text, its new number, or absent when it changed or left.
 */
export function lineMovement(oldText: string | null, newText: string | null): Map<number, number> {
  const rows = buildEmitRows(oldText, newText).rows;
  const map = new Map<number, number>();
  for (const r of rows) {
    if (r.kind === 'context' && r.oldLine !== null && r.newLine !== null) map.set(r.oldLine + 1, r.newLine + 1);
  }
  return map;
}
