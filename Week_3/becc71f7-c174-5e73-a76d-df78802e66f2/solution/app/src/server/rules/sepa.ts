// The SEPA name rule for creditor names.

const FOLDED: Record<string, string> = { Ł: "L", ł: "l", Ø: "O", ø: "o", Æ: "AE", æ: "ae", ß: "ss", Œ: "OE", œ: "oe", Đ: "D", đ: "d", Þ: "TH", þ: "th" };

export function sepaName(name: string): string {
  return [...name]
    .map((character) => FOLDED[character] ?? character)
    .join("")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-zA-Z0-9/\-?:().,'+ ]/g, " ")
    .replace(/ +/g, " ")
    .trim()
    .slice(0, 70);
}
