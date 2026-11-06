/** User-perceived character counting, so one emoji counts as one character. */

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

export function countCharacters(value: string): number {
  let count = 0;
  for (const _segment of segmenter.segment(value)) count += 1;
  return count;
}

export function hasLineBreak(value: string): boolean {
  return /[\r\n]/.test(value);
}
