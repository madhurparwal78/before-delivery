/** Luhn check digit: stamp numbers are eight digits, the last a check digit. */
export function luhnValid(digits: string): boolean {
  if (!/^\d{8}$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < 8; i++) {
    let d = digits.charCodeAt(i) - 48;
    if (i % 2 === 0) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Fold a typed name for sign-off comparison. */
export function foldName(input: string): string {
  const lower = input.toLowerCase();
  const special: Record<string, string> = { ø: "o", ß: "ss", ı: "i", i̇: "i", æ: "ae", œ: "oe", ł: "l", đ: "d" };
  const folded = lower.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  let out = "";
  for (const ch of folded) out += special[ch] ?? ch;
  return out.replace(/\s+/g, " ").trim();
}
export const nameMatches = (typed: string, full: string) => foldName(typed) === foldName(full);
