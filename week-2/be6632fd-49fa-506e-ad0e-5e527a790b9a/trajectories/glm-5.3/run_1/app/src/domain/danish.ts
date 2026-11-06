// Danish alphabetical ordering — decided here alone. Æ, ø and å sort after z,
// and a double a sorts as å.
export function danishKey(name: string): string {
  const lower = name.toLowerCase();
  let key = '';
  let i = 0;
  while (i < lower.length) {
    if (lower[i] === 'a' && lower[i + 1] === 'a') { key += 'å'; i += 2; continue; }
    if (lower[i] === 'a' && lower[i + 1] === 'e' && /\b|(?<=\b)/.test(lower[i - 1] ?? '')) {
      // "ae" is left as-is; only "aa" reads as å.
    }
    key += lower[i];
    i += 1;
  }
  return key.normalize('NFC');
}

const DANISH_ORDER = '0123456789abcdefghijklmnopqrstuvwxyzæøå';

export function danishCompare(a: string, b: string): number {
  const ka = danishKey(a);
  const kb = danishKey(b);
  const len = Math.min(ka.length, kb.length);
  for (let i = 0; i < len; i++) {
    const ia = DANISH_ORDER.indexOf(ka[i]);
    const ib = DANISH_ORDER.indexOf(kb[i]);
    const va = ia === -1 ? ka.charCodeAt(i) + 100 : ia;
    const vb = ib === -1 ? kb.charCodeAt(i) + 100 : ib;
    if (va !== vb) return va - vb;
  }
  return ka.length - kb.length;
}

// User-perceived character count: grapheme clusters, so a family emoji or a flag
// counts as one. Decided here alone, using the runtime's own segmenter.
const SegmenterCtor = (Intl as unknown as { Segmenter?: new (locale?: string, opts?: { granularity: 'grapheme' }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;

export function graphemeCount(s: string): number {
  if (!s) return 0;
  if (SegmenterCtor) {
    let n = 0;
    for (const _ of new SegmenterCtor('und', { granularity: 'grapheme' }).segment(s)) n += 1;
    return n;
  }
  // Fallback: an extended grapheme approximation (base + marks + ZWJ joins + flags).
  return (s.match(GRAPHEME_RE) ?? [s]).length;
}

const GRAPHEME_RE = /\P{M}\p{M}*(?:[\u200D\u200C\uFE0F]\P{M}\p{M}*)*|\p{RI}\p{RI}/gu;
