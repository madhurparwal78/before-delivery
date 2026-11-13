/** The one place the code-point limits and the counting rule are decided. */

export const LIMITS = {
  teamName: 40,
  answerText: 120,
  searchQuery: 80,
  disputeReason: 280,
} as const;

/** Normalise to NFC, then trim leading and trailing white space. */
export function normaliseText(value: string): string {
  return value.normalize('NFC').trim();
}

/** Length of a normalised, trimmed text in Unicode code points. */
export function countCodePoints(value: string): number {
  let count = 0;
  for (const _character of normaliseText(value)) count += 1;
  return count;
}

export type TextVerdict = 'ok' | 'required' | 'too_long';

export function checkText(value: string, limit: number): TextVerdict {
  const used = countCodePoints(value);
  if (used === 0) return 'required';
  if (used > limit) return 'too_long';
  return 'ok';
}
