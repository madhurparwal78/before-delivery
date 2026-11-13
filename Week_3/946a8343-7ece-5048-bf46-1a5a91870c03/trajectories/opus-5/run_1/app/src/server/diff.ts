export type DiffLine = { type: 'context' | 'add' | 'del'; old: number | null; new: number | null; text: string };
export type Hunk = { header: string; lines: DiffLine[] };
export type FileDiff = {
  path: string;
  old_path: string | null;
  status: 'added' | 'modified' | 'deleted' | 'moved';
  hunks: Hunk[];
};

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const parts = text.split('\n');
  if (parts[parts.length - 1] === '') parts.pop();
  return parts;
}

export function joinLines(lines: string[]): string {
  return lines.length === 0 ? '' : `${lines.join('\n')}\n`;
}

function commonSubsequence(a: string[], b: string[]): number[][] {
  const table: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  return table;
}

export function lineDiff(oldLines: string[], newLines: string[]): DiffLine[] {
  const table = commonSubsequence(oldLines, newLines);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < oldLines.length && j < newLines.length) {
    if (oldLines[i] === newLines[j]) {
      out.push({ type: 'context', old: i + 1, new: j + 1, text: oldLines[i] });
      i += 1;
      j += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < oldLines.length && j < newLines.length && oldLines[i] !== newLines[j]) {
      if (table[i + 1][j] >= table[i][j + 1]) {
        dels.push({ type: 'del', old: i + 1, new: null, text: oldLines[i] });
        i += 1;
      } else {
        adds.push({ type: 'add', old: null, new: j + 1, text: newLines[j] });
        j += 1;
      }
    }
    out.push(...dels, ...adds);
  }
  while (i < oldLines.length) {
    out.push({ type: 'del', old: i + 1, new: null, text: oldLines[i] });
    i += 1;
  }
  while (j < newLines.length) {
    out.push({ type: 'add', old: null, new: j + 1, text: newLines[j] });
    j += 1;
  }
  return out;
}

export function hunksOf(lines: DiffLine[], context = 3): Hunk[] {
  const changed: number[] = [];
  lines.forEach((line, index) => {
    if (line.type !== 'context') changed.push(index);
  });
  if (changed.length === 0) return [];
  const ranges: [number, number][] = [];
  for (const index of changed) {
    const start = Math.max(0, index - context);
    const end = Math.min(lines.length - 1, index + context);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last[1] + 1) {
      last[1] = Math.max(last[1], end);
    } else {
      ranges.push([start, end]);
    }
  }
  return ranges.map(([start, end]) => {
    const slice = lines.slice(start, end + 1);
    const oldLines = slice.filter((line) => line.type !== 'add');
    const newLines = slice.filter((line) => line.type !== 'del');
    const oldCount = oldLines.length;
    const newCount = newLines.length;
    let oldStart = oldLines.length > 0 ? (oldLines[0].old ?? 0) : 0;
    let newStart = newLines.length > 0 ? (newLines[0].new ?? 0) : 0;
    if (oldCount === 0) {
      oldStart = lastOldBefore(lines, start);
    }
    if (newCount === 0) {
      newStart = lastNewBefore(lines, start);
    }
    return {
      header: `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`,
      lines: slice,
    };
  });
}

function lastOldBefore(lines: DiffLine[], start: number): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const value = lines[index].old;
    if (value !== null) return value;
  }
  return 0;
}

function lastNewBefore(lines: DiffLine[], start: number): number {
  for (let index = start - 1; index >= 0; index -= 1) {
    const value = lines[index].new;
    if (value !== null) return value;
  }
  return 0;
}

export function fileDiff(path: string, before: string | null, after: string | null, oldPath?: string): FileDiff {
  const oldLines = before === null ? [] : splitLines(before);
  const newLines = after === null ? [] : splitLines(after);
  const status: FileDiff['status'] =
    oldPath !== undefined && oldPath !== path
      ? 'moved'
      : before === null
        ? 'added'
        : after === null
          ? 'deleted'
          : 'modified';
  return {
    path,
    old_path: oldPath !== undefined && oldPath !== path ? oldPath : null,
    status,
    hunks: hunksOf(lineDiff(oldLines, newLines)),
  };
}

export function diffTrees(
  before: Map<string, string>,
  after: Map<string, string>,
): FileDiff[] {
  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  const out: FileDiff[] = [];
  for (const path of [...paths].sort()) {
    const oldText = before.get(path) ?? null;
    const newText = after.get(path) ?? null;
    if (oldText === newText) continue;
    out.push(fileDiff(path, oldText, newText));
  }
  return out;
}

export function changedPaths(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set<string>([...before.keys(), ...after.keys()]);
  return [...paths].filter((path) => (before.get(path) ?? null) !== (after.get(path) ?? null)).sort();
}

type Edit = { start: number; end: number; lines: string[] };

function editsAgainstBase(base: string[], side: string[]): Edit[] {
  const lines = lineDiff(base, side);
  const edits: Edit[] = [];
  let index = 0;
  let baseIndex = 0;
  while (index < lines.length) {
    const line = lines[index];
    if (line.type === 'context') {
      baseIndex += 1;
      index += 1;
      continue;
    }
    const start = baseIndex;
    const added: string[] = [];
    while (index < lines.length && lines[index].type !== 'context') {
      if (lines[index].type === 'del') baseIndex += 1;
      else added.push(lines[index].text);
      index += 1;
    }
    edits.push({ start, end: baseIndex, lines: added });
  }
  return edits;
}

export type MergeResult = { content: string; conflicted: boolean };

export function threeWayMergeText(
  base: string,
  target: string,
  source: string,
  targetLabel: string,
  sourceLabel: string,
): MergeResult {
  const baseLines = splitLines(base);
  const ours = editsAgainstBase(baseLines, splitLines(target));
  const theirs = editsAgainstBase(baseLines, splitLines(source));
  type Marked = Edit & { side: 'ours' | 'theirs' };
  const all: Marked[] = [
    ...ours.map((edit) => ({ ...edit, side: 'ours' as const })),
    ...theirs.map((edit) => ({ ...edit, side: 'theirs' as const })),
  ].sort((a, b) => a.start - b.start || a.end - b.end);
  const clusters: Marked[][] = [];
  for (const edit of all) {
    const last = clusters[clusters.length - 1];
    if (last !== undefined) {
      const spanEnd = Math.max(...last.map((item) => item.end));
      const spanStart = Math.min(...last.map((item) => item.start));
      if (edit.start <= spanEnd && spanStart <= edit.end) {
        last.push(edit);
        continue;
      }
    }
    clusters.push([edit]);
  }
  const out: string[] = [];
  let cursor = 0;
  let conflicted = false;
  for (const cluster of clusters) {
    const start = Math.min(...cluster.map((item) => item.start));
    const end = Math.max(...cluster.map((item) => item.end));
    out.push(...baseLines.slice(cursor, start));
    const ourSide = cluster.filter((item) => item.side === 'ours');
    const theirSide = cluster.filter((item) => item.side === 'theirs');
    const ourText = applyEdits(baseLines, ourSide, start, end);
    const theirText = applyEdits(baseLines, theirSide, start, end);
    if (ourSide.length === 0) {
      out.push(...theirText);
    } else if (theirSide.length === 0) {
      out.push(...ourText);
    } else if (ourText.join('\n') === theirText.join('\n')) {
      out.push(...ourText);
    } else {
      conflicted = true;
      out.push(`<<<<<<< ${targetLabel}`, ...ourText, '=======', ...theirText, `>>>>>>> ${sourceLabel}`);
    }
    cursor = end;
  }
  out.push(...baseLines.slice(cursor));
  return { content: joinLines(out), conflicted };
}

function applyEdits(baseLines: string[], edits: Edit[], start: number, end: number): string[] {
  const out: string[] = [];
  let cursor = start;
  for (const edit of edits.slice().sort((a, b) => a.start - b.start)) {
    out.push(...baseLines.slice(cursor, edit.start));
    out.push(...edit.lines);
    cursor = edit.end;
  }
  out.push(...baseLines.slice(cursor, end));
  return out;
}

export type MergeFileResult = {
  files: Map<string, string>;
  conflicts: string[];
};

export function threeWayMergeTrees(
  base: Map<string, string>,
  target: Map<string, string>,
  source: Map<string, string>,
  targetLabel: string,
  sourceLabel: string,
): MergeFileResult {
  const paths = new Set<string>([...base.keys(), ...target.keys(), ...source.keys()]);
  const files = new Map<string, string>();
  const conflicts: string[] = [];
  for (const path of [...paths].sort()) {
    const baseText = base.get(path);
    const ourText = target.get(path);
    const theirText = source.get(path);
    if (ourText === theirText) {
      if (ourText !== undefined) files.set(path, ourText);
      continue;
    }
    if (baseText === undefined) {
      if (ourText === undefined && theirText !== undefined) {
        files.set(path, theirText);
        continue;
      }
      if (theirText === undefined && ourText !== undefined) {
        files.set(path, ourText);
        continue;
      }
      conflicts.push(path);
      files.set(
        path,
        joinLines([
          `<<<<<<< ${targetLabel}`,
          ...splitLines(ourText ?? ''),
          '=======',
          ...splitLines(theirText ?? ''),
          `>>>>>>> ${sourceLabel}`,
        ]),
      );
      continue;
    }
    if (ourText === undefined) {
      if (theirText === baseText) continue;
      conflicts.push(path);
      files.set(
        path,
        joinLines([`<<<<<<< ${targetLabel}`, '=======', ...splitLines(theirText ?? ''), `>>>>>>> ${sourceLabel}`]),
      );
      continue;
    }
    if (theirText === undefined) {
      if (ourText === baseText) continue;
      conflicts.push(path);
      files.set(
        path,
        joinLines([`<<<<<<< ${targetLabel}`, ...splitLines(ourText), '=======', `>>>>>>> ${sourceLabel}`]),
      );
      continue;
    }
    const merged = threeWayMergeText(baseText, ourText, theirText, targetLabel, sourceLabel);
    if (merged.conflicted) conflicts.push(path);
    files.set(path, merged.content);
  }
  return { files, conflicts: conflicts.sort() };
}

export const conflictMarkerPattern = /^(<<<<<<< |=======$|>>>>>>> )/;

export function hasConflictMarkers(text: string): boolean {
  return splitLines(text).some((line) => line.startsWith('<<<<<<< ') || line === '=======' || line.startsWith('>>>>>>> '));
}
