/** NFC text normalisation and UAX #29 extended grapheme cluster counting. */

const COMBINING_MARK = /[\p{M}]/u;

/** Count extended grapheme clusters per UAX #29 (approximation of the full
 *  spec: base + combining marks + regional indicators + ZWJ sequences). */
export function graphemeCount(s: string): number {
  let count = 0;
  let prev: string | null = null;
  let afterZwj = false;
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (prev === null) {
      count += 1;
      prev = ch;
      afterZwj = false;
      continue;
    }
    if (isExtend(ch)) {
      // extends the previous cluster
    } else if (isRI(prev.codePointAt(0)!) && isRI(cp)) {
      // pair of regional indicators
    } else if (afterZwj) {
      // GB11: ZWJ glues the following pictographic (and any) char
    } else {
      count += 1;
    }
    afterZwj = cp === 0x200d;
    prev = ch;
  }
  return count;
}

function isExtend(ch: string): boolean {
  const cp = ch.codePointAt(0)!;
  if (COMBINING_MARK.test(ch)) return true;
  if (cp === 0x200d) return true; // ZWJ always joins the previous cluster
  if (cp >= 0xfe00 && cp <= 0xfe0f) return true; // variation selectors
  if (cp === 0x200c) return true; // ZWNJ joins
  return false;
}

function isRI(cp: number): boolean {
  return cp >= 0x1f1e6 && cp <= 0x1f1ff;
}

/** Hidden or control characters the API refuses. LF is allowed inside
 *  note, description and reason but never as the final character. */
const FORBIDDEN: Record<number, boolean> = (() => {
  const set = new Set<number>();
  for (let c = 0x00; c <= 0x1f; c++) set.add(c);
  set.add(0x7f);
  for (let c = 0x80; c <= 0x9f; c++) set.add(c); // C1
  set.add(0x85);
  set.add(0x2028); set.add(0x2029); set.add(0x200b); set.add(0x2060); set.add(0xfeff);
  for (let c = 0x202a; c <= 0x202e; c++) set.add(c);
  for (let c = 0x2066; c <= 0x2069; c++) set.add(c);
  return Object.fromEntries([...set].map((c) => [c, true]));
})();

export function hasForbiddenChars(s: string): boolean {
  for (const ch of s) {
    if (FORBIDDEN[ch.codePointAt(0)!]) return true;
  }
  return false;
}

export function nfc(s: string): string {
  return s.normalize('NFC');
}
