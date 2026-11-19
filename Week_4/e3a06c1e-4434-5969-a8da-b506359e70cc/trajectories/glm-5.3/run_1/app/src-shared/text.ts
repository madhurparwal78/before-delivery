// The one place that measures and normalises text under the published text-limit rule.

const WHITESPACE = /[\s\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\u000B\u000C\uFEFF]/;

export function isUnicodeWhitespace(cp: number): boolean {
  if (WHITESPACE.test(String.fromCodePoint(cp))) return true;
  switch (cp) {
    case 0x0009: case 0x000a: case 0x000d: case 0x0020: return true;
    case 0x0085: return true;
    case 0x180e: return false; // historical, no longer White_Space
    default: return false;
  }
}

function trimUnicode(s: string): string {
  let start = 0;
  let end = s.length;
  while (start < end && isUnicodeWhitespace(s.codePointAt(start)!)) start++;
  while (end > start && isUnicodeWhitespace(s.codePointAt(end - 1)!)) end--;
  return s.slice(start, end);
}

export function normaliseText(s: string): string {
  return trimUnicode(s.normalize('NFC'));
}

/** Counts code points after NFC normalisation and Unicode-whitespace trimming. */
export function textLength(s: string): number {
  const t = normaliseText(s);
  let n = 0;
  for (const _ of t) n++;
  return n;
}

/** Passwords are measured raw: code points, no trimming, no NFC. */
export function passwordLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/** Splits on runs of Unicode whitespace (the brief's definition of "words"). */
export function splitWords(s: string): string[] {
  const words: string[] = [];
  let cur = '';
  for (const ch of s) {
    if (isUnicodeWhitespace(ch.codePointAt(0)!)) {
      if (cur !== '') { words.push(cur); cur = ''; }
    } else cur += ch;
  }
  if (cur !== '') words.push(cur);
  return words;
}

/** Validates a value against [min,max] under the text-limit rule; returns the stored value. */
export function checkText(value: string, min: number, max: number): { ok: true; value: string } | { ok: false } {
  const t = normaliseText(value);
  const len = (() => { let n = 0; for (const _ of t) n++; return n; })();
  if (len < min || len > max) return { ok: false };
  return { ok: true, value: t };
}

export function isValidEmail(value: string): boolean {
  const t = normaliseText(value);
  let n = 0; for (const _ of t) n++;
  if (n === 0 || n > 200) return false;
  const at = t.indexOf('@');
  if (at <= 0 || t.indexOf('@', at + 1) !== -1) return false;
  return t.length - at - 1 > 0;
}

/** Case-folded key used for unique-name comparisons. */
export function foldName(name: string): string {
  return normaliseText(name).toLowerCase();
}
