export interface TitleEdit {
  offset: number;
  delete: number;
  insert: string;
}

/** Applies one title edit to a title, counting code points. */
export function applyTitleEdit(title: string, edit: TitleEdit): string {
  const points = [...title];
  const head = points.slice(0, edit.offset).join('');
  const tail = points.slice(edit.offset + edit.delete).join('');
  return head + edit.insert + tail;
}

/**
 * Moves one title edit through an earlier edit of the same title, so that at the
 * same insert offset the earlier edit in server order goes first.
 */
export function transformTitleEdit(edit: TitleEdit, earlier: TitleEdit): TitleEdit {
  const fo = earlier.offset;
  const fd = earlier.delete;
  const fi = [...earlier.insert].length;
  const s = edit.offset;
  const e = edit.offset + edit.delete;

  let start: number;
  if (s < fo) start = s;
  else if (s >= fo + fd) start = s - fd + fi;
  else start = fo + fi;

  let end: number;
  if (e <= fo) end = e;
  else if (e >= fo + fd) end = e - fd + fi;
  else end = fo;

  return { offset: start, delete: Math.max(0, end - start), insert: edit.insert };
}

/** Moves one title edit through every earlier edit, in server order. */
export function rebaseTitleEdit(edit: TitleEdit, earlier: readonly TitleEdit[]): TitleEdit {
  let current = edit;
  for (const previous of earlier) current = transformTitleEdit(current, previous);
  return current;
}

/** Moves a caret in an open title input through a remote title edit. */
export function transformCaret(caret: number, earlier: TitleEdit): number {
  const fo = earlier.offset;
  const fd = earlier.delete;
  const fi = [...earlier.insert].length;
  if (caret < fo) return caret;
  if (caret >= fo + fd) return caret - fd + fi;
  return fo;
}

/**
 * The single edit between two titles: the one range between their longest common
 * prefix and suffix. Used for pending input text and for combined offline edits.
 */
export function diffTitles(before: string, after: string): TitleEdit {
  const a = [...before];
  const b = [...after];
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < a.length - prefix &&
    suffix < b.length - prefix &&
    a[a.length - 1 - suffix] === b[b.length - 1 - suffix]
  ) {
    suffix += 1;
  }
  return {
    offset: prefix,
    delete: a.length - prefix - suffix,
    insert: b.slice(prefix, b.length - suffix).join(''),
  };
}
