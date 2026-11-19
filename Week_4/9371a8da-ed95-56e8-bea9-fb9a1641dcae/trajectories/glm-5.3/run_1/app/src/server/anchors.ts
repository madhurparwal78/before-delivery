/**
 * A replacement applied to a text file, defined by the removed span [a,b)
 * and the length n of the inserted text.
 */
export interface Span {
  a: number;
  b: number;
  n: number;
}

/** Derive the replaced span for a save or restore by stripping common ends. */
export function spanOfChange(oldText: string, newText: string): Span {
  let a = 0;
  const maxA = Math.min(oldText.length, newText.length);
  while (a < maxA && oldText[a] === newText[a]) a++;
  let end = 0;
  const maxEnd = Math.min(oldText.length - a, newText.length - a);
  while (end < maxEnd && oldText[oldText.length - 1 - end] === newText[newText.length - 1 - end]) end++;
  const b = oldText.length - end;
  const n = newText.length - a - end;
  return { a, b, n };
}

export interface MovableAnchor {
  from: number;
  to: number;
}

/** The position rule for a point under a replaced span. */
export function movePoint(p: number, span: Span, isEnd: boolean): number {
  if (span.a === span.b) {
    // Pure insertion at a == b.
    if (isEnd) return p <= span.a ? p : p + span.n;
    return p >= span.b ? p + span.n : p;
  }
  if (p >= span.b) return p + span.n - (span.b - span.a);
  if (p <= span.a) return p;
  return span.a + span.n;
}

/** Move a range anchor [from,to) by the anchor rules. Returns null if covered. */
export function moveRange(from: number, to: number, span: Span): MovableAnchor | null {
  const { a, b, n } = span;
  if (a <= from && to <= b) {
    if (a === b && (from === a || to === a)) {
      // Zero-width span touching the anchor edge: anchor survives by the position rule.
      // from == a && to == a case handled by caller for zero-width anchors.
    }
    return null; // covered -> orphan
  }
  if (from === to) {
    // Zero-width anchor: a pure-insertion suggestion at exactly the insertion point.
    if (span.a === span.b && from === span.a) return { from: from + n, to: to + n };
    return { from: movePoint(from, span, false), to: movePoint(to, span, true) };
  }
  if (a <= from && b <= to && b > from && a < to) {
    // start covered, end beyond
    const nf = a + n;
    const nt = movePoint(to, span, true);
    return { from: nf, to: Math.max(nt, nf) };
  }
  if (from < a && a < to && to <= b) {
    return { from, to: a };
  }
  if (from < a && b < to) {
    return { from, to: to + n - (b - a) };
  }
  const nf = movePoint(from, span, false);
  const nt = movePoint(to, span, true);
  return { from: nf, to: Math.max(nt, nf) };
}

/** Whether an open suggestion [sf, st) with deletion text becomes orphaned by span. */
export function suggestionOrphaned(sf: number, st: number, span: Span): boolean {
  if (sf < st) {
    return sf < span.b && st > span.a;
  }
  return span.a < sf && sf < span.b;
}
