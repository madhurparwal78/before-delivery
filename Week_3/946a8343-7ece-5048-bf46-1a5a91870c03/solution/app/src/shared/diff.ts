// Line diff shared by the server (compare, versions, thread remapping) and the browser (diff views, context expansion).
// Pure functions only: no I/O and no Node imports.

type OpType = "equal" | "del" | "add";

// 1-based line numbers; `old` is null on an addition and `new` is null on a deletion.
export interface DiffOp {
  readonly type: OpType;
  readonly old: number | null;
  readonly new: number | null;
  readonly text: string;
}

type HunkLineType = "context" | "add" | "del";

export interface HunkLine {
  readonly type: HunkLineType;
  readonly old: number | null;
  readonly new: number | null;
  readonly text: string;
}

export interface Hunk {
  readonly header: string;
  readonly oldStart: number;
  readonly oldCount: number;
  readonly newStart: number;
  readonly newCount: number;
  readonly lines: readonly HunkLine[];
}

export const DEFAULT_CONTEXT = 3;
export const EXPAND_STEP = 20;

export function splitLines(text: string): string[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function bisect(a: number[], aLo: number, aHi: number, b: number[], bLo: number, bHi: number): [number, number] | null {
  const n = aHi - aLo;
  const m = bHi - bLo;
  const maxD = Math.ceil((n + m) / 2);
  const offset = maxD;
  const size = 2 * maxD;
  const v1 = new Int32Array(size).fill(-1);
  const v2 = new Int32Array(size).fill(-1);
  v1[offset + 1] = 0;
  v2[offset + 1] = 0;
  const delta = n - m;
  const front = delta % 2 !== 0;
  let k1Start = 0;
  let k1End = 0;
  let k2Start = 0;
  let k2End = 0;
  for (let d = 0; d < maxD; d++) {
    for (let k1 = -d + k1Start; k1 <= d - k1End; k1 += 2) {
      const at = offset + k1;
      let x1 = k1 === -d || (k1 !== d && v1[at - 1] < v1[at + 1]) ? v1[at + 1] : v1[at - 1] + 1;
      let y1 = x1 - k1;
      while (x1 < n && y1 < m && a[aLo + x1] === b[bLo + y1]) {
        x1++;
        y1++;
      }
      v1[at] = x1;
      if (x1 > n) {
        k1End += 2;
      } else if (y1 > m) {
        k1Start += 2;
      } else if (front) {
        const other = offset + delta - k1;
        if (other >= 0 && other < size && v2[other] !== -1 && x1 >= n - v2[other]) return [x1, y1];
      }
    }
    for (let k2 = -d + k2Start; k2 <= d - k2End; k2 += 2) {
      const at = offset + k2;
      let x2 = k2 === -d || (k2 !== d && v2[at - 1] < v2[at + 1]) ? v2[at + 1] : v2[at - 1] + 1;
      let y2 = x2 - k2;
      while (x2 < n && y2 < m && a[aLo + n - x2 - 1] === b[bLo + m - y2 - 1]) {
        x2++;
        y2++;
      }
      v2[at] = x2;
      if (x2 > n) {
        k2End += 2;
      } else if (y2 > m) {
        k2Start += 2;
      } else if (!front) {
        const other = offset + delta - k2;
        if (other >= 0 && other < size && v1[other] !== -1) {
          const x1 = v1[other];
          if (x1 >= n - x2) return [x1, offset + x1 - other];
        }
      }
    }
  }
  return null;
}

// Marks the lines of `a` that are deleted and the lines of `b` that are added. Linear space: it splits at the middle snake.
function markChanges(a: number[], aLo: number, aHi: number, b: number[], bLo: number, bHi: number, deleted: Uint8Array, added: Uint8Array): void {
  while (aLo < aHi && bLo < bHi && a[aLo] === b[bLo]) {
    aLo++;
    bLo++;
  }
  while (aLo < aHi && bLo < bHi && a[aHi - 1] === b[bHi - 1]) {
    aHi--;
    bHi--;
  }
  if (aLo === aHi || bLo === bHi || !markSplit(a, aLo, aHi, b, bLo, bHi, deleted, added)) {
    deleted.fill(1, aLo, aHi);
    added.fill(1, bLo, bHi);
  }
}

function markSplit(a: number[], aLo: number, aHi: number, b: number[], bLo: number, bHi: number, deleted: Uint8Array, added: Uint8Array): boolean {
  const split = bisect(a, aLo, aHi, b, bLo, bHi);
  if (split === null) return false;
  const x = aLo + split[0];
  const y = bLo + split[1];
  markChanges(a, aLo, x, b, bLo, y, deleted, added);
  markChanges(a, x, aHi, b, y, bHi, deleted, added);
  return true;
}

export function diffLines(oldLines: readonly string[], newLines: readonly string[]): DiffOp[] {
  const ids = new Map<string, number>();
  const intern = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const a = oldLines.map(intern);
  const b = newLines.map(intern);
  const deleted = new Uint8Array(a.length);
  const added = new Uint8Array(b.length);
  markChanges(a, 0, a.length, b, 0, b.length, deleted, added);

  const ops: DiffOp[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && deleted[i] === 1) {
      while (i < a.length && deleted[i] === 1) {
        ops.push({ type: "del", old: i + 1, new: null, text: oldLines[i] });
        i++;
      }
    } else if (j < b.length && added[j] === 1) {
      while (j < b.length && added[j] === 1) {
        ops.push({ type: "add", old: null, new: j + 1, text: newLines[j] });
        j++;
      }
    } else {
      ops.push({ type: "equal", old: i + 1, new: j + 1, text: oldLines[i] });
      i++;
      j++;
    }
  }
  return ops;
}

interface OpRange {
  readonly start: number;
  readonly end: number;
}

// Op index ranges (end exclusive) of the hunks: each change keeps `context` lines around it, and ranges that touch or overlap join.
function hunkRanges(ops: readonly DiffOp[], context: number): OpRange[] {
  const ranges: { start: number; end: number }[] = [];
  for (let i = 0; i < ops.length; i++) {
    if (ops[i].type === "equal") continue;
    const start = Math.max(0, i - context);
    const end = Math.min(ops.length, i + context + 1);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  }
  return ranges;
}

function hunkLine(op: DiffOp): HunkLine {
  const type: HunkLineType = op.type === "equal" ? "context" : op.type;
  return { type, old: op.old, new: op.new, text: op.text };
}

function startLine(count: number, before: number): number {
  return count > 0 ? before + 1 : before;
}

export function hunksFromOps(ops: readonly DiffOp[], context: number = DEFAULT_CONTEXT): Hunk[] {
  const hunks: Hunk[] = [];
  let oldBefore = 0;
  let newBefore = 0;
  let cursor = 0;
  for (const range of hunkRanges(ops, context)) {
    for (; cursor < range.start; cursor++) {
      if (ops[cursor].old !== null) oldBefore++;
      if (ops[cursor].new !== null) newBefore++;
    }
    const slice = ops.slice(range.start, range.end);
    const oldCount = slice.filter((op) => op.old !== null).length;
    const newCount = slice.filter((op) => op.new !== null).length;
    const oldStart = startLine(oldCount, oldBefore);
    const newStart = startLine(newCount, newBefore);
    hunks.push({
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      oldStart,
      oldCount,
      newStart,
      newCount,
      lines: slice.map(hunkLine),
    });
  }
  return hunks;
}

export function diffHunks(oldLines: readonly string[], newLines: readonly string[], context: number = DEFAULT_CONTEXT): Hunk[] {
  return hunksFromOps(diffLines(oldLines, newLines), context);
}

// --- Context expansion -------------------------------------------------------------------------------------------------
// Unchanged lines outside the hunks form gaps: gap 0 is the top of the file, gap n the bottom, and gap i the stretch between
// hunk i-1 and hunk i. `below` reveals lines under the hunk before the gap, `above` lines over the hunk after it.

interface GapExpansion {
  readonly above: number;
  readonly below: number;
}

export type Expansion = readonly GapExpansion[];

export type ExpandDirection = "above" | "below";

export interface LineRow extends HunkLine {
  readonly kind: "line";
}

interface GapRow {
  readonly kind: "gap";
  readonly gap: number;
  readonly hidden: number;
  readonly canExpandAbove: boolean;
  readonly canExpandBelow: boolean;
}

export type DiffRow = LineRow | GapRow;

export const NO_EXPANSION: Expansion = [];

export function expandGap(expansion: Expansion, gap: number, direction: ExpandDirection, step: number = EXPAND_STEP): Expansion {
  const next: GapExpansion[] = [];
  for (let i = 0; i <= Math.max(gap, expansion.length - 1); i++) next.push(expansion[i] ?? { above: 0, below: 0 });
  const current = next[gap];
  next[gap] = direction === "above" ? { above: current.above + step, below: current.below } : { above: current.above, below: current.below + step };
  return next;
}

function lineRow(op: DiffOp): LineRow {
  return { kind: "line", ...hunkLine(op) };
}

export function expandedRows(ops: readonly DiffOp[], context: number = DEFAULT_CONTEXT, expansion: Expansion = NO_EXPANSION): DiffRow[] {
  const ranges = hunkRanges(ops, context);
  const rows: DiffRow[] = [];
  if (ranges.length === 0) return rows;
  for (let gap = 0; gap <= ranges.length; gap++) {
    const gapStart = gap === 0 ? 0 : ranges[gap - 1].end;
    const gapEnd = gap === ranges.length ? ops.length : ranges[gap].start;
    const length = gapEnd - gapStart;
    const canExpandBelow = gap > 0;
    const canExpandAbove = gap < ranges.length;
    const below = canExpandBelow ? Math.min(length, expansion[gap]?.below ?? 0) : 0;
    const above = canExpandAbove ? Math.min(length - below, expansion[gap]?.above ?? 0) : 0;
    for (let i = gapStart; i < gapStart + below; i++) rows.push(lineRow(ops[i]));
    const hidden = length - below - above;
    if (hidden > 0) rows.push({ kind: "gap", gap, hidden, canExpandAbove, canExpandBelow });
    for (let i = gapEnd - above; i < gapEnd; i++) rows.push(lineRow(ops[i]));
    if (gap < ranges.length) for (let i = ranges[gap].start; i < ranges[gap].end; i++) rows.push(lineRow(ops[i]));
  }
  return rows;
}

interface PairRow {
  readonly kind: "pair";
  readonly left: HunkLine | null;
  readonly right: HunkLine | null;
}

type SplitRow = PairRow | GapRow;

// Side-by-side layout: a context line sits on both sides; the deletions and additions of a changed block pair up in order.
export function splitRows(rows: readonly DiffRow[]): SplitRow[] {
  const out: SplitRow[] = [];
  let i = 0;
  while (i < rows.length) {
    const row = rows[i];
    if (row.kind === "gap") {
      out.push(row);
      i++;
    } else if (row.type === "context") {
      out.push({ kind: "pair", left: row, right: row });
      i++;
    } else {
      const dels: HunkLine[] = [];
      const adds: HunkLine[] = [];
      for (; i < rows.length; i++) {
        const next = rows[i];
        if (next.kind === "line" && next.type === "del" && adds.length === 0) dels.push(next);
        else if (next.kind === "line" && next.type === "add") adds.push(next);
        else break;
      }
      for (let n = 0; n < Math.max(dels.length, adds.length); n++) out.push({ kind: "pair", left: dels[n] ?? null, right: adds[n] ?? null });
    }
  }
  return out;
}

// --- Line mapping ------------------------------------------------------------------------------------------------------

type Side = "old" | "new";

interface LineRange {
  readonly start: number;
  readonly end: number;
}

export function mapRange(ops: readonly DiffOp[], side: Side, start: number, end: number): LineRange | null {
  if (end < start) return null;
  let found = 0;
  let mappedStart: number | null = null;
  let mappedEnd: number | null = null;
  for (const op of ops) {
    if (op.type !== "equal") continue;
    const own = side === "old" ? op.old : op.new;
    if (own === null || own < start || own > end) continue;
    const other = side === "old" ? op.new : op.old;
    if (own === start) mappedStart = other;
    if (own === end) mappedEnd = other;
    found++;
  }
  if (found !== end - start + 1 || mappedStart === null || mappedEnd === null) return null;
  return { start: mappedStart, end: mappedEnd };
}
