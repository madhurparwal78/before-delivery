import { paneNames, type DiffChange, type DiffResult, type Files, type PaneDiff, type PaneName } from "../shared/types";

export const emptyFiles: Files = { html: "", css: "", js: "" };

function splitLines(text: string): string[] {
  return text === "" ? [] : text.split("\n");
}

/** Myers' O(ND) shortest edit script; returns, for the middle section, which lines of a and b are kept. */
function commonFlags(a: string[], b: string[]): { keepA: boolean[]; keepB: boolean[] } {
  const keepA = new Array<boolean>(a.length).fill(false);
  const keepB = new Array<boolean>(b.length).fill(false);
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    keepA[start] = true;
    keepB[start] = true;
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
    keepA[endA] = true;
    keepB[endB] = true;
  }
  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return { keepA, keepB };
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 2);
  const trace: Int32Array[] = [];
  let found = false;
  for (let d = 0; d <= max && !found; d += 1) {
    trace.push(v.slice());
    const next = v.slice();
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && (v[offset + k - 1] ?? 0) < (v[offset + k + 1] ?? 0))) x = v[offset + k + 1] ?? 0;
      else x = (v[offset + k - 1] ?? 0) + 1;
      let y = x - k;
      while (x < n && y < m && a[start + x] === b[start + y]) {
        x += 1;
        y += 1;
      }
      next[offset + k] = x;
      if (x >= n && y >= m) {
        found = true;
        break;
      }
    }
    v = next;
  }
  let x = n;
  let y = m;
  for (let d = trace.length - 1; d >= 0 && (x > 0 || y > 0); d -= 1) {
    const previous = trace[d] as Int32Array;
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && (previous[offset + k - 1] ?? 0) < (previous[offset + k + 1] ?? 0))) prevK = k + 1;
    else prevK = k - 1;
    const prevX = d === 0 ? 0 : (previous[offset + prevK] ?? 0);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x -= 1;
      y -= 1;
      keepA[start + x] = true;
      keepB[start + y] = true;
    }
    if (d > 0) {
      x = prevX;
      y = prevY;
    }
  }
  return { keepA, keepB };
}

function diffPane(before: string, after: string): PaneDiff {
  const a = splitLines(before);
  const b = splitLines(after);
  const { keepA, keepB } = commonFlags(a, b);
  const rows: PaneDiff["rows"] = [];
  let i = 0;
  let j = 0;
  let added = 0;
  let removed = 0;
  while (i < a.length || j < b.length) {
    while (i < a.length && !keepA[i]) {
      rows.push({ change: "removed", text: a[i] ?? "" });
      removed += 1;
      i += 1;
    }
    while (j < b.length && !keepB[j]) {
      rows.push({ change: "added", text: b[j] ?? "" });
      added += 1;
      j += 1;
    }
    if (i < a.length && j < b.length) {
      rows.push({ change: "same" as DiffChange, text: b[j] ?? "" });
      i += 1;
      j += 1;
    }
  }
  return { added, removed, rows };
}

export function diffFiles(a: number, b: number, before: Files, after: Files): DiffResult {
  const panes = {} as Record<PaneName, PaneDiff>;
  let added = 0;
  let removed = 0;
  for (const pane of paneNames) {
    const paneDiff = diffPane(before[pane], after[pane]);
    panes[pane] = paneDiff;
    added += paneDiff.added;
    removed += paneDiff.removed;
  }
  return { a, b, added, removed, panes };
}

export function changeStats(before: Files, after: Files): { added: number; removed: number; changed_chars: number } {
  const result = diffFiles(0, 0, before, after);
  let changed = 0;
  for (const pane of paneNames) {
    for (const row of result.panes[pane].rows) if (row.change !== "same") changed += [...row.text].length;
  }
  return { added: result.added, removed: result.removed, changed_chars: changed };
}
