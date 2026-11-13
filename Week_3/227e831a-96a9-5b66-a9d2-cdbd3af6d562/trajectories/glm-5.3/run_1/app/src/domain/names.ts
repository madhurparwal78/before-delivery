/**
 * Name normalisation. One decision for an item's identity: NFKC, trim,
 * collapse every run of Unicode white space (including the no-break and
 * ideographic spaces) to one ordinary space, then lowercase.
 */
export function normaliseName(value: string): string {
  const nfkc = value.normalize('NFKC');
  const trimmed = nfkc.trim();
  // \s in JS matches the Unicode White_Space property plus \v and a few more;
  // add the no-break and ideographic spaces explicitly for the record.
  return trimmed.replace(/[\s\u00A0\u2007\u202F\u3000]+/g, ' ').toLowerCase();
}
