const SUBSTITUTES: Record<string, string> = { ø: "o", ß: "ss", ı: "i", æ: "ae", œ: "oe", ł: "l", đ: "d" };

/** The published folding table: names compare ignoring case, accents and surrounding spaces. */
export function foldName(name: string): string {
  return name
    .trim()
    .replace(/İ/g, "i")
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[øßıæœłđ]/g, (letter) => SUBSTITUTES[letter] ?? letter);
}
