import type { EditMode, OpEntry, Span, TextEdit } from './types.js';

/**
 * Moves a position across one text edit. `winsTie` decides what happens to a
 * position that sits exactly where an insert lands: the winner stays put and
 * therefore ends up before the inserted text.
 */
export function shiftPos(pos: number, by: TextEdit, winsTie: boolean): number {
  if (by.kind === 'insert') {
    if (by.at < pos || (by.at === pos && !winsTie)) return pos + by.length;
    return pos;
  }
  if (by.at + by.length <= pos) return pos - by.length;
  if (by.at < pos) return by.at;
  return pos;
}

export function shiftSpan(span: Span, by: TextEdit): Span | null {
  const at = shiftPos(span.at, by, false);
  const end = shiftPos(span.at + span.length, by, true);
  return end > at ? { at, length: end - at } : null;
}

export function shiftSpanThrough(span: Span, edits: readonly TextEdit[]): Span | null {
  let current: Span | null = span;
  for (const edit of edits) {
    if (!current) return null;
    current = shiftSpan(current, edit);
  }
  return current;
}

export function shiftPosThrough(pos: number, edits: readonly TextEdit[], winsTie: boolean): number {
  let current = pos;
  for (const edit of edits) current = shiftPos(current, edit, winsTie);
  return current;
}

function xform1(edit: TextEdit, by: TextEdit, editWins: boolean): TextEdit[] {
  if (edit.kind === 'insert') {
    return [{ kind: 'insert', at: shiftPos(edit.at, by, editWins), length: edit.length }];
  }
  const start = edit.at;
  const end = edit.at + edit.length;
  if (by.kind === 'insert') {
    if (by.at <= start) return [{ kind: 'delete', at: start + by.length, length: edit.length }];
    if (by.at >= end) return [edit];
    // The inserted text is kept: delete the two surviving halves, higher offset first.
    return [
      { kind: 'delete', at: by.at + by.length, length: end - by.at },
      { kind: 'delete', at: start, length: by.at - start },
    ];
  }
  const newStart = shiftPos(start, by, true);
  const newEnd = shiftPos(end, by, true);
  return newEnd > newStart ? [{ kind: 'delete', at: newStart, length: newEnd - newStart }] : [];
}

/**
 * Transforms two sequential edit scripts that both start from the same text.
 * `aWins` breaks ties between inserts at one offset: the winner's text ends up first.
 */
export function xform(
  a: readonly TextEdit[],
  b: readonly TextEdit[],
  aWins: boolean,
): { a2: TextEdit[]; b2: TextEdit[] } {
  if (a.length === 0) return { a2: [], b2: [...b] };
  if (b.length === 0) return { a2: [...a], b2: [] };
  const a0 = a[0] as TextEdit;
  const b0 = b[0] as TextEdit;
  if (a.length === 1 && b.length === 1) {
    return { a2: xform1(a0, b0, aWins), b2: xform1(b0, a0, !aWins) };
  }
  if (a.length > 1) {
    const head = xform([a0], b, aWins);
    const tail = xform(a.slice(1), head.b2, aWins);
    return { a2: [...head.a2, ...tail.a2], b2: tail.b2 };
  }
  const head = xform(a, [b0], aWins);
  const tail = xform(head.a2, b.slice(1), aWins);
  return { a2: tail.a2, b2: [...head.b2, ...tail.b2] };
}

/** The text changes an op entry makes. A suggesting-mode delete leaves the text alone. */
export function entryTextEdits(entry: OpEntry, mode: EditMode): TextEdit[] {
  if ('insert' in entry) return [{ kind: 'insert', at: entry.at, length: entry.insert.length }];
  if ('delete' in entry) {
    return mode === 'editing' ? [{ kind: 'delete', at: entry.at, length: entry.delete }] : [];
  }
  return [];
}

/**
 * Moves one op entry across concurrent text edits, and reports those same edits
 * expressed as they stand after the entry is applied.
 */
export function rebaseEntry(
  entry: OpEntry,
  mode: EditMode,
  against: readonly TextEdit[],
  entryWins: boolean,
): { entries: OpEntry[]; against: TextEdit[] } {
  const mine = entryTextEdits(entry, mode);
  const { a2, b2 } = xform(mine, against, entryWins);
  if ('insert' in entry) {
    const first = a2[0];
    const at = first ? first.at : shiftPosThrough(entry.at, against, entryWins);
    return { entries: [{ insert: entry.insert, at }], against: b2 };
  }
  if ('delete' in entry) {
    if (mode === 'editing') {
      return { entries: a2.map((edit) => ({ delete: edit.length, at: edit.at })), against: b2 };
    }
    const span = shiftSpanThrough({ at: entry.at, length: entry.delete }, against);
    return { entries: span ? [{ delete: span.length, at: span.at }] : [], against: b2 };
  }
  if ('style' in entry) {
    return { entries: [{ style: entry.style, at: shiftPosThrough(entry.at, against, false) }], against: b2 };
  }
  const span = shiftSpanThrough({ at: entry.at, length: entry.length }, against);
  if (!span) return { entries: [], against: b2 };
  const moved: OpEntry =
    entry.mark === 'link'
      ? { mark: 'link', value: entry.value, at: span.at, length: span.length }
      : { mark: entry.mark, value: entry.value, at: span.at, length: span.length };
  return { entries: [moved], against: b2 };
}

/** Moves a whole frame of op entries across concurrent text edits. */
export function rebaseEntries(
  entries: readonly OpEntry[],
  mode: EditMode,
  against: readonly TextEdit[],
  entriesWin: boolean,
): { entries: OpEntry[]; against: TextEdit[] } {
  let remaining: TextEdit[] = [...against];
  const out: OpEntry[] = [];
  for (const entry of entries) {
    const result = rebaseEntry(entry, mode, remaining, entriesWin);
    out.push(...result.entries);
    remaining = result.against;
  }
  return { entries: out, against: remaining };
}
