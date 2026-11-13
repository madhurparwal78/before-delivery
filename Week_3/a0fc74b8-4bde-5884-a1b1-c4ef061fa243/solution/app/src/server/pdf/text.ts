const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556, 556, 556, 556, 556, 556, 556,
  556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778,
  722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222,
  500, 222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

export function ascii(text: string): string {
  let out = "";
  for (const char of text) {
    const code = char.codePointAt(0) ?? 63;
    out += code >= 32 && code <= 126 ? char : "?";
  }
  return out;
}

function textWidth(text: string, size: number): number {
  let total = 0;
  for (const char of ascii(text)) total += WIDTHS[char.charCodeAt(0) - 32] ?? 556;
  return (total * size) / 1000;
}

export function fitSize(text: string, maxWidth: number, preferred: number, minimum: number): number {
  const natural = textWidth(text, preferred);
  if (natural <= maxWidth) return preferred;
  return Math.max(minimum, (preferred * maxWidth) / natural);
}
