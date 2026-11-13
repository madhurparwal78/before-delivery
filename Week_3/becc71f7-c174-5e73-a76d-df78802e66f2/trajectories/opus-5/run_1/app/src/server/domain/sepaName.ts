/**
 * The SEPA name rule, used for every creditor name in a bank transfer file and for
 * the order payouts are numbered in. It lives here alone.
 *
 * "Zoë & Łukasz Ørsted-Hæk" becomes "Zoe Lukasz Orsted-Haek", and "Ségolène D’Hondt"
 * with a curly apostrophe becomes "Segolene D Hondt".
 */

const TRANSLITERATIONS: ReadonlyArray<readonly [string, string]> = [
  ['Ł', 'L'],
  ['ł', 'l'],
  ['Ø', 'O'],
  ['ø', 'o'],
  ['Æ', 'AE'],
  ['æ', 'ae'],
  ['ß', 'ss'],
  ['Œ', 'OE'],
  ['œ', 'oe'],
  ['Đ', 'D'],
  ['đ', 'd'],
  ['Þ', 'TH'],
  ['þ', 'th'],
];

const ALLOWED = /[a-zA-Z0-9/\-?:()., '+]/;

export function sepaName(input: string): string {
  let mapped = input;
  for (const [from, to] of TRANSLITERATIONS) {
    mapped = mapped.split(from).join(to);
  }
  const stripped = mapped.normalize('NFKD').replace(/\p{M}/gu, '');
  const allowedOnly = [...stripped].map((character) => (ALLOWED.test(character) ? character : ' ')).join('');
  return allowedOnly.replace(/ +/g, ' ').trim().slice(0, 70);
}
