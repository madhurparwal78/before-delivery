/**
 * The one name normalisation rule, used for customer names and counterparty
 * legal names alike.
 */

const LETTER_MAP: ReadonlyArray<readonly [string, string]> = [
  ['Æ', 'AE'],
  ['æ', 'AE'],
  ['Ø', 'O'],
  ['ø', 'O'],
  ['Ł', 'L'],
  ['ł', 'L'],
  ['Đ', 'D'],
  ['đ', 'D'],
  ['ß', 'SS'],
  ['ẞ', 'SS'],
  ['Œ', 'OE'],
  ['œ', 'OE'],
  ['Þ', 'TH'],
  ['þ', 'TH'],
];

export function normaliseName(input: string): string {
  let text = input.normalize('NFKD').replace(/\p{M}+/gu, '');
  for (const [from, to] of LETTER_MAP) {
    text = text.split(from).join(to);
  }
  text = text.toUpperCase();
  text = text.replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  return text;
}

export function nameTokens(input: string): string[] {
  const normalised = normaliseName(input);
  return normalised === '' ? [] : normalised.split(' ');
}

export type NameCheckResult = 'match' | 'partial' | 'no_match';

function containsAllTokens(shorter: readonly string[], longer: readonly string[]): boolean {
  const pool = [...longer];
  for (const token of shorter) {
    const at = pool.indexOf(token);
    if (at === -1) return false;
    pool.splice(at, 1);
  }
  return true;
}

export function checkNames(left: string, right: string): NameCheckResult {
  const a = nameTokens(left);
  const b = nameTokens(right);
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length === longer.length && containsAllTokens(shorter, longer)) return 'match';
  if (longer.length === shorter.length + 1 && containsAllTokens(shorter, longer)) return 'partial';
  return 'no_match';
}

/** The public exchange search: the normalised query contained in the normalised name. */
export function nameMatchesSearch(name: string, query: string): boolean {
  const needle = normaliseName(query);
  if (needle === '') return true;
  return normaliseName(name).includes(needle);
}
