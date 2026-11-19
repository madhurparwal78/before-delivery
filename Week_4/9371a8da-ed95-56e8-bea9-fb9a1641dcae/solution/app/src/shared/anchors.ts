// The anchor rules: every change to a text file is one replaced span, and every
// anchor, caret and selection end follows that span by the rules below.

/** The old text from `a` to `b` was replaced by `inserted` (length `n`). */
export interface ReplacedSpan {
  a: number;
  b: number;
  n: number;
  inserted: string;
}

interface Range {
  from: number;
  to: number;
}

/** Strip the longest common beginning, then the longest common ending of what remains. */
export function replacedSpan(before: string, after: string): ReplacedSpan {
  const limit = Math.min(before.length, after.length);
  let start = 0;
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)) {
    endBefore -= 1;
    endAfter -= 1;
  }
  const inserted = after.slice(start, endAfter);
  return { a: start, b: endBefore, n: inserted.length, inserted };
}

export function spanFor(range: Range, inserted: string): ReplacedSpan {
  return { a: range.from, b: range.to, n: inserted.length, inserted };
}

function shift(span: ReplacedSpan): number {
  return span.n - (span.b - span.a);
}

/**
 * Position rule: at or after `b` moves, at or before `a` stays. When `a` equals `b`
 * an anchor's start counts as after the edit and its end as before it.
 */
function movePosition(position: number, span: ReplacedSpan, edge: "start" | "end"): number {
  if (span.a === span.b && position === span.a) return edge === "start" ? position + span.n : position;
  return position >= span.b ? position + shift(span) : position;
}

/** A thread's passage after the span, or null when the whole passage was covered (orphaned). */
export function moveThreadAnchor(range: Range, span: ReplacedSpan): Range | null {
  const { from, to } = range;
  const { a, b, n } = span;
  if (a <= from && to <= b) return null;
  if (a <= from && from < b && b < to) return { from: a + n, to: to + shift(span) };
  if (from < a && a < to && to <= b) return { from, to: a };
  if (from < a && b < to) return { from, to: to + shift(span) };
  return { from: movePosition(from, span, "start"), to: movePosition(to, span, "end") };
}

/** An open suggestion's range after the span, or null when the span orphans it. */
export function moveSuggestionAnchor(range: Range, span: ReplacedSpan): Range | null {
  const { from, to } = range;
  const { a, b, n } = span;
  if (from === to) {
    if (a < from && from < b) return null;
    if (a === b && from === a) return { from: from + n, to: to + n };
    const moved = movePosition(from, span, "start");
    return { from: moved, to: moved };
  }
  const overlaps = a === b ? from < a && a < to : a < to && from < b;
  if (overlaps) return null;
  return { from: movePosition(from, span, "start"), to: movePosition(to, span, "end") };
}

/** Where a caret or selection end lands when newer text replaces the span. */
export function carryCaret(position: number, span: ReplacedSpan): number {
  if (position <= span.a) return position;
  if (position >= span.b) return position + shift(span);
  return span.a + span.n;
}
