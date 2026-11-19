import { NAME_MAX, NAME_MIN, PASSWORD_MAX, PASSWORD_MIN } from './constants.js';

const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Counts user-perceived characters (grapheme clusters). */
export function graphemeLength(value: string): number {
  let count = 0;
  for (const _segment of segmenter.segment(value)) count += 1;
  return count;
}

function withinLength(value: string, min: number, max: number): boolean {
  const length = graphemeLength(value);
  return length >= min && length <= max;
}

/** Display names and hero names: 3 to 20 after trimming. */
export function nameWithinLimit(value: string): boolean {
  return withinLength(value.trim(), NAME_MIN, NAME_MAX);
}

/** Passwords: 10 to 128, not trimmed. */
export function passwordWithinLimit(value: string): boolean {
  return withinLength(value, PASSWORD_MIN, PASSWORD_MAX);
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;

export function isWellFormedEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
