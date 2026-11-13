/**
 * House rule H3: every text key compares by Unicode code point of its stored
 * (composed) form, never by locale or database collation.
 */

export function cmpText(a: string, b: string): number {
  const left = Array.from(a);
  const right = Array.from(b);
  const shared = Math.min(left.length, right.length);
  for (let i = 0; i < shared; i += 1) {
    const x = left[i].codePointAt(0)!;
    const y = right[i].codePointAt(0)!;
    if (x !== y) return x < y ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

export function cmpNumber(a: number, b: number): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/** Compares in the order of the given comparators, taking the first difference. */
export function chain<T>(...comparators: ((a: T, b: T) => number)[]): (a: T, b: T) => number {
  return (a, b) => {
    for (const comparator of comparators) {
      const result = comparator(a, b);
      if (result !== 0) return result;
    }
    return 0;
  };
}

export function descending<T>(comparator: (a: T, b: T) => number): (a: T, b: T) => number {
  return (a, b) => -comparator(a, b);
}

/** H3: the folded form used for email comparison, independent of H1. */
export function foldEmail(email: string): string {
  return email.toUpperCase().toLowerCase();
}

/** Text is stored as NFC. */
export function normaliseText(text: string): string {
  return text.normalize('NFC');
}

let segmenter: Intl.Segmenter | null = null;

/** Every length limit on stored text counts grapheme segments. */
export function graphemeLength(text: string): number {
  if (!segmenter) segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
  let count = 0;
  for (const _segment of segmenter.segment(text)) count += 1;
  return count;
}
