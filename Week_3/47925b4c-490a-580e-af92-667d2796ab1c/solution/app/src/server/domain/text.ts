const REFUSED = /[\u0000-\u001f\u007f\u2028\u2029\u200b\u200c\u200d\u2060\ufeff]/;

const graphemes = new Intl.Segmenter('en', { granularity: 'grapheme' });

function graphemeCount(text: string): number {
  let count = 0;
  for (const _ of graphemes.segment(text)) count += 1;
  return count;
}

interface SiteName {
  readonly ok: boolean;
  readonly value: string;
}

/** A site name, NFC-normalised and counted in grapheme clusters. */
export function normaliseSiteName(text: string): SiteName {
  const value = text.normalize('NFC');
  const length = graphemeCount(value);
  const ok = !REFUSED.test(value) && length >= 1 && length <= 80;
  return { ok, value };
}
