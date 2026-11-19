/**
 * The folding table. One place for lower-casing and accent folding used by every search.
 */
const FOLD: Record<string, string> = {
  "ı": "i",
  "İ": "i",
  "ş": "s",
  "ğ": "g",
  "ç": "c",
  "ö": "o",
  "ü": "u",
  "é": "e",
  "è": "e",
  "ê": "e",
  "ë": "e",
  "à": "a",
  "â": "a",
  "ã": "a",
  "á": "a",
  "î": "i",
  "í": "i",
  "ô": "o",
  "õ": "o",
  "ó": "o",
  "ù": "u",
  "û": "u",
  "ú": "u",
  "ñ": "n",
};

export function foldChar(ch: string): string {
  return FOLD[ch] ?? ch;
}

export function fold(s: string): string {
  return [...s].map((ch) => foldChar(ch)).join("").toLowerCase();
}

/** A search needle holds a haystack when its folded form appears in the folded haystack. */
export function foldMatches(haystack: string, needle: string): boolean {
  const h = fold(haystack);
  const n = fold(needle.trim());
  if (n.length === 0) return true;
  return h.includes(n);
}
