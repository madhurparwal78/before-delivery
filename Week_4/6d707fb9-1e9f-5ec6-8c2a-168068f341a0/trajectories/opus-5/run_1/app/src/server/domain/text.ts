const FOLD: Record<string, string> = {
  '\u0131': 'i',
  '\u0130': 'i',
  '\u015f': 's',
  '\u015e': 's',
  '\u011f': 'g',
  '\u011e': 'g',
  '\u00e7': 'c',
  '\u00c7': 'c',
  '\u00f6': 'o',
  '\u00d6': 'o',
  '\u00fc': 'u',
  '\u00dc': 'u',
  '\u00e9': 'e',
  '\u00e8': 'e',
  '\u00ea': 'e',
  '\u00eb': 'e',
  '\u00c9': 'e',
  '\u00c8': 'e',
  '\u00ca': 'e',
  '\u00cb': 'e',
  '\u00e0': 'a',
  '\u00e2': 'a',
  '\u00e3': 'a',
  '\u00e1': 'a',
  '\u00c0': 'a',
  '\u00c2': 'a',
  '\u00c3': 'a',
  '\u00c1': 'a',
  '\u00ee': 'i',
  '\u00ed': 'i',
  '\u00ce': 'i',
  '\u00cd': 'i',
  '\u00f4': 'o',
  '\u00f5': 'o',
  '\u00f3': 'o',
  '\u00d4': 'o',
  '\u00d5': 'o',
  '\u00d3': 'o',
  '\u00f9': 'u',
  '\u00fb': 'u',
  '\u00fa': 'u',
  '\u00d9': 'u',
  '\u00db': 'u',
  '\u00da': 'u',
  '\u00f1': 'n',
  '\u00d1': 'n',
};

/** The published folding table for search. */
export function fold(text: string): string {
  return [...text]
    .map((c) => FOLD[c] ?? c)
    .join('')
    .toLowerCase();
}

/** Characters with an emoji counted as one. */
export function countCharacters(text: string): number {
  return [...new Intl.Segmenter('en', { granularity: 'grapheme' }).segment(text)].length;
}

/** The mod-10 check digit a 13-digit GTIN should carry. */
export function gtinCheckDigit(first12: string): number {
  let total = 0;
  for (let index = 0; index < 12; index += 1) {
    const digit = Number(first12[index]);
    total += index % 2 === 0 ? digit : digit * 3;
  }
  return (10 - (total % 10)) % 10;
}

export type GtinProblem = { kind: 'length' } | { kind: 'checkDigit'; digit: number };

export function checkGtin(value: string): GtinProblem | null {
  if (!/^\d{13}$/.test(value)) return { kind: 'length' };
  const digit = gtinCheckDigit(value.slice(0, 12));
  if (digit !== Number(value[12])) return { kind: 'checkDigit', digit };
  return null;
}
