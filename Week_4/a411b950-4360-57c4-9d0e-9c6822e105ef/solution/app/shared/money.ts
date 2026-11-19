// Money is integer cents everywhere; these are the only conversions to and from decimal text.

const DECIMAL = /^(-?)(\d+)(?:\.(\d+))?$/;

/** 435 → "4.35", 30000000 → "300000.00" (string arithmetic, no floating point). */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return `${sign}${digits.slice(0, -2)}.${digits.slice(-2)}`;
}

/** "4.35" → 435, "1,450" → 145000; null when the text is not a plain decimal with at most two significant decimals. */
export function decimalToCents(text: string): number | null {
  const match = DECIMAL.exec(text.trim().replaceAll(",", ""));
  if (!match) return null;
  const [, sign = "", whole = "0", fraction = ""] = match;
  if (/[1-9]/.test(fraction.slice(2))) return null;
  const cents = Number.parseInt(`${whole}${fraction.slice(0, 2).padEnd(2, "0")}`, 10);
  return sign === "-" ? -cents : cents;
}

/** 123456 → "1,234.56" (no currency sign). */
export function formatUsd(cents: number): string {
  const [whole = "0", fraction = "00"] = centsToDecimal(cents).split(".");
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${fraction}`;
}
