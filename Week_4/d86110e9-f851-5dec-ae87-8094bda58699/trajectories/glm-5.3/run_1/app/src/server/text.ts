// Text rules: character counting as a person sees it (so an emoji counts as 1)
// and the decimal-number rule used by conditions.

export function charCount(s: string): number {
  return Array.from(s.trim() === s ? s : s).length;
}

// "Optional sign, digits and an optional fraction; no exponent, hex, Infinity
// or NaN." Returns the numeric value or null when the text is not a number.
export function parseDecimal(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  if (!/^[+-]?[0-9]*\.?[0-9]+$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
