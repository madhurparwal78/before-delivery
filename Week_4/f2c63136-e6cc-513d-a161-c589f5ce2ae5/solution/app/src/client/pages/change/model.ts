import type { DiffFile } from '../../../shared/types.ts';

export type ViewMode = 'split' | 'unified';

export interface RowRef {
  key: string;
  path: string;
  kind: 'context' | 'added' | 'removed';
  old: number | null;
  new: number | null;
  side: 'old' | 'new';
  text: string;
}

const rowKey = (path: string, kind: string, old: number | null, nw: number | null, side: string): string => `${path}|${kind}|${old ?? ''}|${nw ?? ''}|${side}`;

const shown = (text: string): string => (text === '' ? '(empty line)' : text);

/** The accessible name of a diff row (brief: Row accessible names). */
export function rowName(row: Pick<RowRef, 'kind' | 'old' | 'new' | 'text'>): string {
  if (row.kind === 'added') return `Line ${row.new}, added: ${shown(row.text)}`;
  if (row.kind === 'removed') return `Old line ${row.old}, removed: ${shown(row.text)}`;
  return `Line ${row.new}, unchanged: ${shown(row.text)}`;
}

/** The line number the comment button and dialog name: the new line, or the old line of a removed row. */
export const commentLine = (row: Pick<RowRef, 'kind' | 'old' | 'new'>): number => (row.kind === 'removed' ? row.old! : row.new!);

function refOf(path: string, kind: RowRef['kind'], old: number | null, nw: number | null, side: RowRef['side'], text: string): RowRef {
  return { key: rowKey(path, kind, old, nw, side), path, kind, old, new: nw, side, text };
}

type Unit = { type: 'hunk'; header: string } | { type: 'row'; row: RowRef } | { type: 'pair'; left: RowRef | null; right: RowRef | null };

/** The rows of one file as the view shows them: unified rows, or split pairs with context on both sides. */
export function unitsOf(file: DiffFile, mode: ViewMode): Unit[] {
  const units: Unit[] = [];
  for (const hunk of file.hunks) {
    units.push({ type: 'hunk', header: hunk.header });
    const rows = hunk.rows.filter((row) => row.kind !== 'hunk');
    if (mode === 'unified') {
      for (const row of rows) {
        const kind = row.kind as RowRef['kind'];
        units.push({ type: 'row', row: refOf(file.path, kind, row.old_line, row.new_line, kind === 'removed' ? 'old' : 'new', row.text) });
      }
      continue;
    }
    for (let i = 0; i < rows.length; ) {
      const row = rows[i];
      if (row.kind === 'context') {
        units.push({
          type: 'pair',
          left: refOf(file.path, 'context', row.old_line, row.new_line, 'old', row.text),
          right: refOf(file.path, 'context', row.old_line, row.new_line, 'new', row.text),
        });
        i += 1;
        continue;
      }
      const removed: typeof rows = [];
      const added: typeof rows = [];
      while (i < rows.length && rows[i].kind === 'removed') removed.push(rows[i++]);
      while (i < rows.length && rows[i].kind === 'added') added.push(rows[i++]);
      for (let k = 0; k < Math.max(removed.length, added.length); k += 1) {
        const left = removed[k];
        const right = added[k];
        units.push({
          type: 'pair',
          left: left ? refOf(file.path, 'removed', left.old_line, null, 'old', left.text) : null,
          right: right ? refOf(file.path, 'added', null, right.new_line, 'new', right.text) : null,
        });
      }
    }
  }
  return units;
}

/** Every non-hunk row in document order across files; in split a context line appears twice (old row, then new row). */
export function navigationRows(files: DiffFile[], mode: ViewMode): RowRef[] {
  const rows: RowRef[] = [];
  for (const file of files) {
    for (const unit of unitsOf(file, 'unified')) {
      if (unit.type !== 'row') continue;
      const row = unit.row;
      if (mode === 'split' && row.kind === 'context') rows.push({ ...row, side: 'old', key: rowKey(row.path, row.kind, row.old, row.new, 'old') }, row);
      else rows.push(row);
    }
  }
  return rows;
}

export function rowAnchorsThread(row: RowRef, thread: { path: string; side: 'old' | 'new'; line: number }): boolean {
  if (row.path !== thread.path) return false;
  return thread.side === 'new' ? row.new === thread.line && row.kind !== 'removed' : row.old === thread.line && row.kind !== 'added';
}
