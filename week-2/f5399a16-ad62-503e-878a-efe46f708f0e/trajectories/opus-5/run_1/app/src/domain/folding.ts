/** The folding table, used by search, typed names and the edit decision list. */
const SMALL_FOLDS: ReadonlyArray<readonly [string, string]> = [
  ['àáâãäå', 'a'],
  ['æ', 'ae'],
  ['ç', 'c'],
  ['èéêë', 'e'],
  ['ìíîïı', 'i'],
  ['ñ', 'n'],
  ['òóôõöø', 'o'],
  ['œ', 'oe'],
  ['ùúûü', 'u'],
  ['ýÿ', 'y'],
  ['ß', 'ss'],
];

const SMALL_MAP = new Map<string, string>();
const CAPITAL_MAP = new Map<string, string>();

for (const [characters, fold] of SMALL_FOLDS) {
  for (const character of characters) {
    SMALL_MAP.set(character, fold);
    CAPITAL_MAP.set(character.toUpperCase(), fold.toUpperCase());
  }
}
// The i row names the dotted capital on its own; its lower case is two characters.
SMALL_MAP.set('İ', 'i');
CAPITAL_MAP.set('İ', 'I');
CAPITAL_MAP.set('ẞ', 'SS');

/** Folded and lower cased, for comparing search text and typed names. */
export function foldForCompare(text: string): string {
  let folded = '';
  for (const character of text) {
    folded += SMALL_MAP.get(character) ?? CAPITAL_MAP.get(character)?.toLowerCase() ?? character;
  }
  return folded.toLowerCase();
}

/** Printable ASCII stays as it is, case included; anything else folds, then becomes `_`. */
export function foldToAscii(text: string): string {
  let folded = '';
  for (const character of text) {
    if (isPrintableAscii(character)) {
      folded += character;
      continue;
    }
    const candidate = CAPITAL_MAP.get(character) ?? SMALL_MAP.get(character);
    folded += candidate !== undefined && [...candidate].every(isPrintableAscii) ? candidate : '_';
  }
  return folded;
}

function isPrintableAscii(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return character.length === 1 && code >= 32 && code <= 126;
}

export function namesMatch(typed: string, held: string): boolean {
  return foldForCompare(typed) === foldForCompare(held);
}

/** Titles compare after folding and lower casing, character by character by code point. */
export function compareTitles(a: string, b: string): number {
  const left = foldForCompare(a);
  const right = foldForCompare(b);
  return left < right ? -1 : left > right ? 1 : 0;
}
