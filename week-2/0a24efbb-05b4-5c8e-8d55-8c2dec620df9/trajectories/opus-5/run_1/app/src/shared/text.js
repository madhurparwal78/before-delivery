const graphemeSegmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * The folded form of a work address: Unicode NFKC normalisation, then lower-casing.
 * Folding never maps one script onto another, so a look-alike from another alphabet
 * stays a different address.
 */
export function foldWorkAddress(value) {
  return String(value).normalize('NFKC').toLowerCase();
}

/** Unicode extended grapheme clusters, measured after trimming surrounding white space. */
export function graphemeLength(value) {
  let count = 0;
  for (const _ of graphemeSegmenter.segment(String(value).trim())) count += 1;
  return count;
}

export function hasNul(value) {
  return typeof value === 'string' && value.includes('\u0000');
}

export function initialsOf(name) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => [...part][0].toUpperCase())
    .join('');
}

/** A seeded name split at the first space, as the realm holds it. */
export function splitName(name) {
  const at = name.indexOf(' ');
  if (at === -1) return { firstName: name, lastName: '' };
  return { firstName: name.slice(0, at), lastName: name.slice(at + 1) };
}
