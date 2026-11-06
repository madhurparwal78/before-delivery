// The folding table for search, typed names and the edit decision list.

const SMALL: Record<string, string> = {
  à: 'a', á: 'a', â: 'a', ã: 'a', ä: 'a', å: 'a',
  æ: 'ae',
  ç: 'c',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i', ı: 'i',
  ñ: 'n',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ö: 'o', ø: 'o',
  œ: 'oe',
  ù: 'u', ú: 'u', û: 'u', ü: 'u',
  ý: 'y', ÿ: 'y',
  ß: 'ss',
};

const CAPITAL: Record<string, string> = {
  İ: 'I',
  ẞ: 'SS',
  Ÿ: 'Y',
};
for (const [from, to] of Object.entries(SMALL)) {
  if (from !== 'ı' && from !== 'ß' && from !== 'ÿ') CAPITAL[from.toUpperCase()] = to.toUpperCase();
}

const TABLE: Record<string, string> = { ...SMALL, ...CAPITAL };

function foldCharacters(text: string): string {
  return Array.from(text, (character) => TABLE[character] ?? character).join('');
}

/** The form names are compared and searched in: folded and lower-cased. */
export function foldedKey(text: string): string {
  return foldCharacters(text).toLowerCase();
}

/** Printable ASCII for an edit decision list: capitals stay capitals, anything left becomes `_`. */
export function foldedAscii(text: string): string {
  return Array.from(foldCharacters(text), (character) => {
    const code = character.codePointAt(0) as number;
    return code >= 32 && code <= 126 ? character : '_';
  }).join('');
}
