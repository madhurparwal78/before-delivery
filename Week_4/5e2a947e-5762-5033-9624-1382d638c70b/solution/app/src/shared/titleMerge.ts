/** A title edit replaces `delete` code points at `offset` with `insert`, against one version of the title. */
export interface TitleEdit {
  offset: number;
  delete: number;
  insert: string;
}

const codePoints = (text: string): string[] => Array.from(text);

export function applyTitleEdit(title: string, edit: TitleEdit): string {
  const points = codePoints(title);
  const start = Math.min(Math.max(edit.offset, 0), points.length);
  const end = Math.min(start + Math.max(edit.delete, 0), points.length);
  return [...points.slice(0, start), edit.insert, ...points.slice(end)].join('');
}

/** Move an edit through an edit that was applied before it, both made against the same base title. */
export function transformTitleEdit(edit: TitleEdit, earlier: TitleEdit): TitleEdit {
  const fi = codePoints(earlier.insert).length;
  const fo = earlier.offset;
  const fe = fo + earlier.delete;
  const s = edit.offset;
  const e = edit.offset + edit.delete;
  const start = s < fo ? s : s >= fe ? s - earlier.delete + fi : fo + fi;
  const end = e <= fo ? e : e >= fe ? e - earlier.delete + fi : fo;
  return { offset: start, delete: Math.max(0, end - start), insert: edit.insert };
}

/** Move a caret through an edit that arrived from someone else. */
export function mapCaret(caret: number, earlier: TitleEdit): number {
  const fi = codePoints(earlier.insert).length;
  if (caret < earlier.offset) return caret;
  if (caret >= earlier.offset + earlier.delete) return caret - earlier.delete + fi;
  return earlier.offset + fi;
}

/** The single range between two texts: the longest common prefix and suffix are kept. */
export function diffTitleEdit(before: string, after: string): TitleEdit | null {
  const a = codePoints(before);
  const b = codePoints(after);
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < a.length - prefix && suffix < b.length - prefix && a[a.length - 1 - suffix] === b[b.length - 1 - suffix]) {
    suffix += 1;
  }
  const removed = a.length - prefix - suffix;
  const insert = b.slice(prefix, b.length - suffix).join('');
  if (removed === 0 && insert === '') return null;
  return { offset: prefix, delete: removed, insert };
}

/** Collapse whitespace runs to one space and trim, the way every title is stored. */
export function normaliseTitle(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
