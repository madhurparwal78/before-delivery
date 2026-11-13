import { splitLines } from './repo.js';

export type LineType = 'context' | 'add' | 'del';

export interface DiffLine {
  type: LineType;
  old: number | null;
  new: number | null;
  text: string;
}

export interface DiffHunk {
  header: string;
  lines: DiffLine[];
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
}

export interface FileDiff {
  path: string;
  old_path: string;
  status: 'added' | 'modified' | 'deleted' | 'moved';
  hunks: DiffHunk[];
}

type RawOp = { type: LineType; ai: number; bi: number };

/** Minimal line diff by longest common subsequence. Deletions print before additions. */
export function lcsDiff(a: string[], b: string[]): RawOp[] {
  const n = a.length;
  const m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      if (a[i] === b[j]) dp[i][j] = dp[i + 1][j + 1] + 1;
      else dp[i][j] = Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: RawOp[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ type: 'context', ai: i, bi: j });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', ai: i, bi: j });
      i++;
    } else {
      out.push({ type: 'add', ai: i, bi: j });
      j++;
    }
  }
  while (i < n) {
    out.push({ type: 'del', ai: i, bi: j });
    i++;
  }
  while (j < m) {
    out.push({ type: 'add', ai: i, bi: j });
    j++;
  }
  return out;
}

export function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = splitLines(oldText);
  const b = splitLines(newText);
  const raw = lcsDiff(a, b);
  return raw.map((r) => ({
    type: r.type,
    old: r.type === 'add' ? null : r.ai + 1,
    new: r.type === 'del' ? null : r.bi + 1,
    text: r.type === 'add' ? b[r.bi] : a[r.ai],
  }));
}

export function hunkHeaderOf(oldStart: number, oldCount: number, newStart: number, newCount: number): string {
  return `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`;
}

export function rebuildHunk(hunkLines: DiffLine[]): DiffHunk {
  let oldLines = 0;
  let newLines = 0;
  let firstOld: number | null = null;
  let firstNew: number | null = null;
  for (const l of hunkLines) {
    if (l.type !== 'add') {
      if (firstOld === null) firstOld = l.old!;
      oldLines++;
    }
    if (l.type !== 'del') {
      if (firstNew === null) firstNew = l.new!;
      newLines++;
    }
  }
  const oldStart = firstOld ?? 0;
  const newStart = firstNew ?? 0;
  return { header: hunkHeaderOf(oldStart, oldLines, newStart, newLines), lines: hunkLines, oldStart, oldCount: oldLines, newStart, newCount: newLines };
}

export function buildHunks(lines: DiffLine[], context: number): DiffHunk[] {
  const changedIdx: number[] = [];
  lines.forEach((l, idx) => {
    if (l.type !== 'context') changedIdx.push(idx);
  });
  if (changedIdx.length === 0) return [];
  const groups: Array<Array<{ start: number; end: number }>> = [];
  let cur: Array<{ start: number; end: number }> = [];
  let lastCovered = -Infinity;
  for (const idx of changedIdx) {
    const start = Math.max(0, idx - context);
    const end = Math.min(lines.length - 1, idx + context);
    if (cur.length === 0 || start <= lastCovered + 1) {
      cur.push({ start, end });
    } else {
      groups.push(cur);
      cur = [{ start, end }];
    }
    lastCovered = end;
  }
  if (cur.length > 0) groups.push(cur);

  const hunks: DiffHunk[] = [];
  for (const g of groups) {
    const start = g[0].start;
    const end = g[g.length - 1].end;
    hunks.push(rebuildHunk(lines.slice(start, end + 1)));
  }
  return hunks;
}

export function diffFiles(oldText: string, newText: string, oldPath: string, newPath: string): FileDiff {
  const lines = diffLines(oldText, newText);
  let status: FileDiff['status'] = 'modified';
  if (oldPath !== newPath) status = 'moved';
  else if (oldText === '' && newText !== '') status = 'added';
  else if (newText === '' && oldText !== '') status = 'deleted';
  else if (oldText === '' && newText === '') status = 'added';
  return { path: newPath, old_path: oldPath, status, hunks: buildHunks(lines, 3) };
}

export function expandHunk(h: DiffHunk, direction: 'above' | 'below', allLines: DiffLine[]): DiffHunk | null {
  const first = allLines.indexOf(h.lines[0]);
  const last = allLines.indexOf(h.lines[h.lines.length - 1]);
  if (first < 0 || last < 0) return null;
  if (direction === 'above') {
    const newFirst = Math.max(0, first - 20);
    if (newFirst === first) return null;
    return rebuildHunk(allLines.slice(newFirst, last + 1));
  }
  const newLast = Math.min(allLines.length - 1, last + 20);
  if (newLast === last) return null;
  return rebuildHunk(allLines.slice(first, newLast + 1));
}

// ---- Three-way merge ----

export interface ChangeRange {
  start: number; // first base line replaced (0-based)
  end: number; // last base line replaced; start-1 for a pure insertion
  text: string[];
}

export function changedRanges(base: string[], other: string[]): ChangeRange[] {
  const raw = lcsDiff(base, other);
  const ranges: ChangeRange[] = [];
  let cur: ChangeRange | null = null;
  const flush = (): void => {
    if (cur) ranges.push(cur);
    cur = null;
  };
  for (let i = 0; i < raw.length; i++) {
    const r = raw[i];
    const nextIsChange = i + 1 < raw.length && raw[i + 1].type !== 'context';
    if (r.type === 'context') {
      if (cur && !nextIsChange) flush();
      continue;
    }
    if (!cur) cur = { start: r.ai, end: r.ai - 1, text: [] };
    if (r.type === 'del') {
      cur.end = Math.max(cur.end, r.ai);
    } else {
      cur.text.push(other[r.bi]);
    }
  }
  flush();
  return ranges;
}

export interface ThreeWayResult {
  text: string;
  conflictCount: number;
}

/** Merge two sides against a base. `ours` is the target side and `theirs` the source side. */
export function mergeThreeWay(baseText: string, oursText: string, theirsText: string, oursLabel: string, theirsLabel: string): ThreeWayResult {
  const base = splitLines(baseText);
  const ours = splitLines(oursText);
  const theirs = splitLines(theirsText);
  const ourRanges = changedRanges(base, ours);
  const theirRanges = changedRanges(base, theirs);
  const all = [
    ...ourRanges.map((r) => ({ ...r, who: 'ours' as const })),
    ...theirRanges.map((r) => ({ ...r, who: 'theirs' as const })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);

  const out: string[] = [];
  let conflictCount = 0;
  let pos = 0;
  let i = 0;
  while (i < all.length) {
    const r = all[i];
    const group = [r];
    let end = r.end;
    let j = i + 1;
    while (j < all.length && all[j].start <= end + 1) {
      group.push(all[j]);
      end = Math.max(end, all[j].end);
      j++;
    }
    const gs = Math.min(...group.map((g) => g.start));
    const ge = Math.max(...group.map((g) => g.end));
    for (let k = pos; k < gs && k < base.length; k++) out.push(base[k]);
    const ourText = sideText(base, ourRanges, gs, ge);
    const theirText = sideText(base, theirRanges, gs, ge);
    const onlyOurs = group.every((g) => g.who === 'ours');
    const onlyTheirs = group.every((g) => g.who === 'theirs');
    const sameBoth =
      !onlyOurs && !onlyTheirs &&
      ourRanges.length === 1 && theirRanges.length === 1 &&
      ourText.join('\n') === theirText.join('\n');
    if (sameBoth) {
      out.push(...ourText);
    } else if (onlyOurs) {
      out.push(...ourText);
    } else if (onlyTheirs) {
      out.push(...theirText);
    } else {
      conflictCount++;
      out.push(`<<<<<<< ${oursLabel}`, ...ourText, '=======', ...theirText, `>>>>>>> ${theirsLabel}`);
    }
    pos = ge + 1;
    i = j;
  }
  for (let k = pos; k < base.length; k++) out.push(base[k]);
  return { text: out.length === 0 ? '' : out.join('\n'), conflictCount };
}

function sideText(base: string[], ranges: ChangeRange[], from: number, to: number): string[] {
  const out: string[] = [];
  let pos = from;
  for (const r of ranges) {
    if (r.end < from - 1 || r.start > to + 1) continue;
    for (let k = pos; k < r.start && k <= to && k < base.length; k++) out.push(base[k]);
    out.push(...r.text);
    pos = Math.max(pos, r.end + 1);
  }
  for (let k = pos; k <= to && k < base.length; k++) out.push(base[k]);
  return out;
}

/** Merge one file's three states. A null state means the file is absent on that side. */
export function mergeFileStates(
  baseContent: string | null,
  oursContent: string | null,
  theirsContent: string | null,
  oursLabel: string,
  theirsLabel: string,
): { content: string | null; conflict: boolean } {
  const oursHad = oursContent !== null;
  const theirsHad = theirsContent !== null;
  const baseHad = baseContent !== null;
  if (oursHad && theirsHad) {
    if (oursContent === theirsContent) return { content: oursContent, conflict: false };
    if (!baseHad) {
      return {
        content: [`<<<<<<< ${oursLabel}`, ...splitLines(oursContent), '=======', ...splitLines(theirsContent), `>>>>>>> ${theirsLabel}`].join('\n'),
        conflict: true,
      };
    }
    if (oursContent === baseContent) return { content: theirsContent, conflict: false };
    if (theirsContent === baseContent) return { content: oursContent, conflict: false };
    const res = mergeThreeWay(baseContent, oursContent, theirsContent, oursLabel, theirsLabel);
    return { content: res.text, conflict: res.conflictCount > 0 };
  }
  if (baseHad && oursHad && !theirsHad) {
    if (oursContent !== baseContent) {
      return {
        content: [`<<<<<<< ${oursLabel}`, ...splitLines(oursContent), '=======', `>>>>>>> ${theirsLabel}`].join('\n'),
        conflict: true,
      };
    }
    return { content: null, conflict: false };
  }
  if (baseHad && !oursHad && theirsHad) {
    if (theirsContent !== baseContent) {
      return {
        content: [`<<<<<<< ${oursLabel}`, '=======', ...splitLines(theirsContent), `>>>>>>> ${theirsLabel}`].join('\n'),
        conflict: true,
      };
    }
    return { content: null, conflict: false };
  }
  return { content: null, conflict: false };
}

export function applySuggestion(files: Map<string, string>, path: string, startLine: number, endLine: number, lines: string[]): Map<string, string> {
  const out = new Map(files);
  const cur = out.get(path) ?? '';
  const curLines = splitLines(cur);
  const next = [...curLines.slice(0, startLine - 1), ...lines, ...curLines.slice(endLine)];
  const joined = next.join('\n');
  out.set(path, cur.endsWith('\n') && !joined.endsWith('\n') ? `${joined}\n` : joined);
  return out;
}

export function hasConflictMarkers(text: string): boolean {
  return splitLines(text).some((l) => l.startsWith('<<<<<<< ') || l.startsWith('=======') || l.startsWith('>>>>>>> '));
}
