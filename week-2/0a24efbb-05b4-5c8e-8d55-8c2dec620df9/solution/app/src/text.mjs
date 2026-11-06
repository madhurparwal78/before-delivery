// How the desk measures text and compares work addresses, decided here and nowhere else.

const graphemes = new Intl.Segmenter("en", { granularity: "grapheme" });

/** The length of a reason or note: extended grapheme clusters, measured after trimming. */
export function graphemeCount(text) {
  let count = 0;
  for (const _ of graphemes.segment(text.trim())) count += 1;
  return count;
}

/** A work address in its folded form: NFKC normalisation, then lower-casing. Scripts are never mapped onto each other. */
export function fold(address) {
  return address.normalize("NFKC").toLowerCase();
}

/** The same fold over a stored column, for comparisons made inside postgres. */
export function foldedColumn(column) {
  return `lower(normalize(${column}, NFKC))`;
}
