/**
 * The anchor rules. Every change to a text file is one replaced span: the old
 * text from `a` to `b` becomes `n` characters of new text. Offsets count UTF-16
 * code units, exactly as the API's `from` and `to` do.
 */
export interface ReplacedSpan {
  a: number;
  b: number;
  n: number;
}

export function spanDelta(span: ReplacedSpan): number {
  return span.n - (span.b - span.a);
}

/** The single replaced span between two versions of a text file. */
export function computeSpan(oldText: string, newText: string): ReplacedSpan {
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText.charCodeAt(prefix) === newText.charCodeAt(prefix)) {
    prefix += 1;
  }
  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText.charCodeAt(oldText.length - 1 - suffix) ===
      newText.charCodeAt(newText.length - 1 - suffix)
  ) {
    suffix += 1;
  }
  return {
    a: prefix,
    b: oldText.length - suffix,
    n: newText.length - prefix - suffix,
  };
}

export function spanOfReplacement(from: number, to: number, inserted: string): ReplacedSpan {
  return { a: from, b: to, n: inserted.length };
}

/** The position rule, applied to an anchor's start. */
export function moveStart(position: number, span: ReplacedSpan): number {
  const delta = spanDelta(span);
  if (span.a === span.b) return position >= span.b ? position + delta : position;
  if (position >= span.b) return position + delta;
  return position;
}

/** The position rule, applied to an anchor's end. */
export function moveEnd(position: number, span: ReplacedSpan): number {
  const delta = spanDelta(span);
  if (span.a === span.b) return position > span.a ? position + delta : position;
  if (position >= span.b) return position + delta;
  return position;
}

/** How a caret or a selection end follows the replaced span. */
export function moveCaret(position: number, span: ReplacedSpan): number {
  if (position <= span.a) return position;
  if (position >= span.b) return position + spanDelta(span);
  return span.a + span.n;
}

export type AnchorMove = { orphaned: true } | { orphaned: false; from: number; to: number };

export function moveThreadAnchor(from: number, to: number, span: ReplacedSpan): AnchorMove {
  const { a, b, n } = span;
  const delta = spanDelta(span);
  if (a <= from && to <= b && a !== b) return { orphaned: true };
  if (a <= from && from < b && b < to) return { orphaned: false, from: a + n, to: to + delta };
  if (from < a && a < to && to <= b && a !== b) return { orphaned: false, from, to: a };
  if (from < a && b < to) return { orphaned: false, from, to: to + delta };
  return { orphaned: false, from: moveStart(from, span), to: moveEnd(to, span) };
}

export function moveSuggestionAnchor(from: number, to: number, span: ReplacedSpan): AnchorMove {
  const { a, b, n } = span;
  if (from === to) {
    if (a !== b && from > a && from < b) return { orphaned: true };
    if (a === b && from === a) return { orphaned: false, from: from + n, to: to + n };
    return { orphaned: false, from: moveStart(from, span), to: moveEnd(to, span) };
  }
  if (a === b) {
    if (a > from && a < to) return { orphaned: true };
    return { orphaned: false, from: moveStart(from, span), to: moveEnd(to, span) };
  }
  if (a < to && from < b) return { orphaned: true };
  return { orphaned: false, from: moveStart(from, span), to: moveEnd(to, span) };
}
