const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });

/** Counts user-perceived characters (grapheme clusters). */
export function graphemeLength(value: string): number {
  let count = 0;
  for (const _segment of segmenter.segment(value)) count += 1;
  return count;
}

/** Names and chat bodies are trimmed before counting. */
export function trimForLimit(value: string): string {
  return value.trim();
}

export function withinLength(value: string, min: number, max: number): boolean {
  const length = graphemeLength(value);
  return length >= min && length <= max;
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s.]+$/;

export function isWellFormedEmail(value: string): boolean {
  return EMAIL_RE.test(value);
}
