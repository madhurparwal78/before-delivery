// Folds names for comparison, search matching and the ASCII edit decision
// list. One table decides all three; each caller applies its own extra rules.

const SMALL_FOLDS: Record<string, string> = {
  "à": "a", "á": "a", "â": "a", "ã": "a", "ä": "a", "å": "a",
  "æ": "ae",
  "ç": "c",
  "è": "e", "é": "e", "ê": "e", "ë": "e",
  "ì": "i", "í": "i", "î": "i", "ï": "i", "ı": "i",
  "ñ": "n",
  "ò": "o", "ó": "o", "ô": "o", "õ": "o", "ö": "o", "ø": "o",
  "œ": "oe",
  "ù": "u", "ú": "u", "û": "u", "ü": "u",
  "ý": "y", "ÿ": "y",
  "ß": "ss",
  "ẞ": "ss",
};

const CAPITAL_FOLDS: Record<string, string> = {
  "À": "A", "Á": "A", "Â": "A", "Ã": "A", "Ä": "A", "Å": "A",
  "Æ": "AE",
  "Ç": "C",
  "È": "E", "É": "E", "Ê": "E", "Ë": "E",
  "Ì": "I", "Í": "I", "Î": "I", "Ï": "I", "İ": "I",
  "Ñ": "N",
  "Ò": "O", "Ó": "O", "Ô": "O", "Õ": "O", "Ö": "O", "Ø": "O",
  "Œ": "OE",
  "Ù": "U", "Ú": "U", "Û": "U", "Ü": "U",
  "Ý": "Y",
};

// The comparison folding used by search and typed names: case-insensitive, so
// every letter folds to its small form. An Arabic name is typed exactly, since
// no letter of it is in the folding table.
export function foldForCompare(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const small = SMALL_FOLDS[ch];
      if (small !== undefined) return small;
      const capital = CAPITAL_FOLDS[ch];
      if (capital !== undefined) return capital.toLowerCase();
      return ch.toLowerCase();
    })
    .join("");
}

// The edit decision list folding: a capital folds to capitals, a small letter
// to small letters, and a character still outside printable ASCII (32 to
// 126) after folding becomes `_`.
export function foldAscii(text: string): string {
  return Array.from(text)
    .map((ch) => {
      const capital = CAPITAL_FOLDS[ch];
      if (capital !== undefined) return asciiOrUnderscore(capital);
      const small = SMALL_FOLDS[ch];
      if (small !== undefined) return asciiOrUnderscore(small);
      return asciiOrUnderscore(ch);
    })
    .join("");
}

function asciiOrUnderscore(text: string): string {
  const printable = Array.from(text).every((c) => {
    const code = c.codePointAt(0)!;
    return code >= 32 && code <= 126;
  });
  return printable ? text : "_";
}

// The sort key of a title: folded, then lower-cased, compared character by
// character in Unicode code point order.
export function titleSortKey(text: string): string {
  return foldForCompare(text);
}
