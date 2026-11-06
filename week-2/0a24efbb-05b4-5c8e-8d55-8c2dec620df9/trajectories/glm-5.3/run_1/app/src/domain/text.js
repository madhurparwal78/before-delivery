export function foldAddress(address) {
  if (typeof address !== 'string') return address;
  return address.normalize('NFKC').toLowerCase();
}

const segmenter = typeof Intl.Segmenter === 'function'
  ? new Intl.Segmenter('en', { granularity: 'grapheme' })
  : null;

/**
 * Count Unicode extended grapheme clusters, after trimming leading/trailing
 * white space. A flag pair, a ZWJ sequence, a skin-tone-modified base and a
 * combining sequence each count as one.
 */
export function graphemeCount(text) {
  if (typeof text !== 'string') return 0;
  const trimmed = trimGraphemes(text);
  if (!segmenter) return [...trimmed].length;
  let n = 0;
  for (const _ of segmenter.segment(trimmed)) n++;
  return n;
}

export function trimGraphemes(text) {
  if (typeof text !== 'string') return text;
  return text.replace(/^[\s\u0085]+|[\s\u0085]+$/g, '');
}
