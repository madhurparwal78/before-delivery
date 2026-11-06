// Name normalisation, the beneficiary name check and the support agent's masking: one rule each.

const LETTER_MAP: Record<string, string> = {
  Æ: "AE", æ: "ae", Ø: "O", ø: "o", Ł: "L", ł: "l", Đ: "D", đ: "d", ß: "SS", ẞ: "SS", Œ: "OE", œ: "oe", Þ: "TH", þ: "th",
};

/** NFKD without combining marks, the published letter map, upper case, non-alphanumerics to one space. */
export function normaliseName(name: string): string {
  const stripped = name.normalize("NFKD").replace(/\p{M}/gu, "");
  const mapped = [...stripped].map((ch) => LETTER_MAP[ch] ?? ch).join("");
  return mapped.toUpperCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
}

export type NameCheck = "match" | "partial" | "no_match";

/** Match: the same tokens in any order. Partial: the longer name has exactly one extra token. */
export function compareNames(a: string, b: string): NameCheck {
  const left = normaliseName(a).split(" ").filter(Boolean).sort();
  const right = normaliseName(b).split(" ").filter(Boolean).sort();
  if (left.length === right.length && left.every((t, i) => t === right[i])) return "match";
  const [shorter, longer] = left.length < right.length ? [left, right] : [right, left];
  if (longer.length !== shorter.length + 1 || shorter.length === 0) return "no_match";
  const pool = [...longer];
  for (const token of shorter) {
    const at = pool.indexOf(token);
    if (at < 0) return "no_match";
    pool.splice(at, 1);
  }
  return "partial";
}

/** `Łukasz Ørsted-Ækvist` → `Ł. Ø. Æ.` */
export function initials(name: string): string {
  return name.split(/[\s-]+/u).filter(Boolean).map((part) => `${[...part][0]}.`).join(" ");
}

/** `TEST-ID-0001` → `…0001` */
export function maskIdentity(identityNumber: string): string {
  return `…${[...identityNumber].slice(-4).join("")}`;
}

/** Text lengths count Unicode code points, so an emoji counts as 1. */
export function codePoints(text: string): number {
  return [...text].length;
}
