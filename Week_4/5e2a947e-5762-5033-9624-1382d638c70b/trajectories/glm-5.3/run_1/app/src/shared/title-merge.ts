/**
 * The title merge transform: the one implementation of the published
 * offset remapping rule used for concurrent edits of one title.
 */

export interface TitleEdit {
  offset: number;
  delete: number;
  insert: string;
}

interface Frame {
  fo: number;
  fd: number;
  fi: number;
}

function mapPoint(v: number, f: Frame): number {
  if (v < f.fo) return v;
  if (v >= f.fo + f.fd) return v - f.fd + f.fi;
  return f.fo;
}

/** Map the start of a range with the start rule. */
function mapStart(s: number, f: Frame): number {
  if (s < f.fo) return s;
  if (s >= f.fo + f.fd) return s - f.fd + f.fi;
  return f.fo + f.fi;
}

/**
 * Move `edit` through the earlier edit frame `f`, as published:
 * the start maps by the start rule and the end by the end rule,
 * then the edit deletes max(0, newEnd − newStart).
 */
export function transformThrough(edit: TitleEdit, f: Frame): TitleEdit {
  const s = mapStart(edit.offset, f);
  const e = mapPoint(edit.offset + edit.delete, f);
  const del = Math.max(0, e - s);
  return { offset: s, delete: del, insert: edit.insert };
}

/** Fold one edit through a list of earlier frames, in order. */
export function transformThroughAll(edit: TitleEdit, frames: TitleEdit[]): TitleEdit {
  let cur = edit;
  for (const fr of frames) {
    cur = transformThrough(cur, { fo: fr.offset, fd: fr.delete, fi: [...fr.insert].length });
  }
  return cur;
}

export function applyEdit(title: string, edit: TitleEdit): string {
  const s = Math.min(edit.offset, [...title].length);
  const chars = [...title];
  const removed = chars.splice(s, edit.delete, ...[...edit.insert]);
  void removed;
  return chars.join('');
}

/** Merge a remote edit into the caret position c, as published. */
export function moveCaret(c: number, f: Frame): number {
  if (c < f.fo) return c;
  if (c >= f.fo + f.fd) return c - f.fd + f.fi;
  return f.fo;
}

export function caretAfterRemote(c: number, remote: TitleEdit): number {
  return moveCaret(c, { fo: remote.offset, fd: remote.delete, fi: [...remote.insert].length });
}

/** The pending edit between the opening title and my text. */
export function pendingEdit(opening: string, text: string): TitleEdit {
  const a = [...opening];
  const b = [...text];
  let p = 0;
  while (p < a.length && p < b.length && a[p] === b[p]) p += 1;
  let s = 0;
  while (s < a.length - p && s < b.length - p && a[a.length - 1 - s] === b[b.length - 1 - s]) s += 1;
  return {
    offset: p,
    delete: a.length - p - s,
    insert: b.slice(p, b.length - s).join(''),
  };
}
