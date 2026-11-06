const AE = '\u0001';
const OE = '\u0002';
const AA = '\u0003';

/** a…z, then æ, ø, å, mapped onto A…Z then a, b, c so byte order is Danish order. */
const ALPHABET = `abcdefghijklmnopqrstuvwxyz${AE}${OE}${AA}`;
const RANKS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabc';

/**
 * A sort key whose byte order is Danish alphabetical order: æ, ø and å after z, and a double a
 * sorted as å. Spaces sort before punctuation, punctuation before digits and digits before
 * letters. Compared with the C collation so the database agrees byte for byte.
 */
export function danishSortKey(name: string): string {
  const folded = name
    .normalize('NFC')
    .toLowerCase()
    .replace(/aa/g, AA)
    .replace(/[æä]/g, AE)
    .replace(/[øö]/g, OE)
    .replace(/å/g, AA)
    .normalize('NFD')
    .replace(/\p{Mn}+/gu, '');

  let key = '';
  for (const character of folded) {
    const rank = ALPHABET.indexOf(character);
    if (rank >= 0) {
      key += RANKS[rank] as string;
    } else if (character >= '0' && character <= '9') {
      key += character;
    } else if (/\s/u.test(character)) {
      key += ' ';
    } else {
      key += '!';
    }
  }
  return key;
}

export function compareDanish(a: string, b: string): number {
  const keyA = danishSortKey(a);
  const keyB = danishSortKey(b);
  return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
}
