import { nfkd, stripCombiningMarks } from '../../shared/unicode.js';

// --- LEI: ISO 17442 with ISO 7064 MOD 97-10 check digits ---
export function isValidLei(raw: string): boolean {
  const value = raw.toUpperCase();
  if (!/^[0-9A-Z]{18}[0-9]{2}$/.test(value)) return false;
  let numeric = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    if (code >= 48 && code <= 57) numeric += ch;
    else numeric += (code - 55).toString(); // A=10 ... Z=35
  }
  const remainder = BigInt(numeric) % 97n;
  return remainder === 1n;
}

export function normaliseLei(raw: string): string {
  return raw.toUpperCase();
}

// --- Name normalisation (one rule for customer and counterparty legal names) ---
const SPECIAL_MAP: Record<string, string> = {
  'Æ': 'AE', 'æ': 'AE', 'Ǿ': 'O', 'Ø': 'O', 'ø': 'O', 'Ł': 'L', 'ł': 'L',
  'Đ': 'D', 'đ': 'D', 'ẞ': 'SS', 'ß': 'SS', 'Œ': 'OE', 'œ': 'OE', 'Þ': 'TH', 'þ': 'TH',
};

export function normaliseName(name: string): string {
  const decomposed = stripCombiningMarks(nfkd(name));
  let mapped = '';
  for (const ch of decomposed) {
    const replacement = SPECIAL_MAP[ch];
    if (replacement !== undefined) mapped += replacement;
    else {
      const upperCh = ch.toUpperCase();
      mapped += SPECIAL_MAP[upperCh] !== undefined ? SPECIAL_MAP[upperCh] : ch;
    }
  }
  const uppered = mapped.toUpperCase();
  const collapsed = uppered.replace(/[^0-9A-Z]+/g, ' ').trim();
  return collapsed;
}

export function nameTokens(name: string): string[] {
  const normalised = normaliseName(name);
  return normalised === '' ? [] : normalised.split(' ');
}

export type NameMatch = 'match' | 'partial' | 'no_match';

export function compareNames(a: string, b: string): NameMatch {
  const ta = nameTokens(a);
  const tb = nameTokens(b);
  if (ta.length === 0 && tb.length === 0) return 'match';
  const setB = new Set(tb);
  const setA = new Set(ta);
  const same = ta.length === tb.length && ta.every((t) => setB.has(t));
  if (same) return 'match';
  const shorter = ta.length <= tb.length ? ta : tb;
  const longer = ta.length <= tb.length ? tb : ta;
  const longerSet = longer === ta ? setA : setB;
  const allIn = shorter.every((t) => longerSet.has(t));
  if (allIn && longer.length === shorter.length + 1) return 'partial';
  return 'no_match';
}

export function containsNormalised(haystackName: string, needle: string): boolean {
  const normalisedQuery = normaliseName(needle);
  if (normalisedQuery === '') return true;
  return normaliseName(haystackName).includes(normalisedQuery);
}
