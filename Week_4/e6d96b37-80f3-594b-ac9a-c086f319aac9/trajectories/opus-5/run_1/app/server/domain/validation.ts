import { limits } from '../config.ts';

/**
 * Field-level validation. Text lengths are counted in user-perceived
 * characters, so an emoji counts as one.
 */

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function characterCount(text: string): number {
  let total = 0;
  for (const _ of graphemes.segment(text)) total += 1;
  return total;
}

const REFERENCE = /^[A-Za-z0-9-]{1,80}$/;

/** A reference is 1 to 80 ASCII letters, digits or hyphens. */
export function isValidReference(value: string): boolean {
  return REFERENCE.test(value);
}

export const noteTooLong = (text: string): boolean =>
  characterCount(text) > limits.noteMaxChars;

export const correctionTooLong = (text: string): boolean =>
  characterCount(text) > limits.correctionMaxChars;

/** Coordinates are integers inside the photograph's original pixel grid. */
export function isInsidePhoto(
  x: number,
  y: number,
  photo: { width: number; height: number },
): boolean {
  return (
    Number.isInteger(x) &&
    Number.isInteger(y) &&
    x >= 0 &&
    y >= 0 &&
    x <= photo.width - 1 &&
    y <= photo.height - 1
  );
}

/** An order must list each member exactly once. */
export function listsEachOnce(order: string[], members: string[]): boolean {
  if (order.length !== members.length) return false;
  const wanted = new Set(members);
  const seen = new Set<string>();
  for (const key of order) {
    if (!wanted.has(key) || seen.has(key)) return false;
    seen.add(key);
  }
  return true;
}

const NAMESPACE = /^[a-z0-9-]+$/;

/** A namespace is lowercase ASCII letters, digits and hyphens. */
export function isValidNamespace(value: string): boolean {
  return (
    value.length >= 1 &&
    value.length <= limits.namespaceMaxChars &&
    NAMESPACE.test(value)
  );
}
