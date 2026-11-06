// Unicode helpers using regex with the u flag: NFKD normalisation and
// combining-mark stripping, used by the one name-normalisation rule.
export function nfkd(s: string): string {
  return s.normalize('NFKD');
}

export function stripCombiningMarks(s: string): string {
  return s.replace(/\p{Mark}/gu, '');
}

export function codePointCount(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

export function isUpperLetter(s: string): boolean {
  return /\p{L}/u.test(s) && s === s.toUpperCase();
}

export function upper(s: string): string {
  return s.toUpperCase();
}
