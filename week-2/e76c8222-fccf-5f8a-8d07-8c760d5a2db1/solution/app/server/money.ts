// Money is integer cents; hours are integer hundredths. Text in, text out, no floats.

const MONEY = /^\d{1,7}\.\d{2}$/;

/** "80.00" → 8000; null for anything that is not a two-decimal amount. */
export function parseMoney(text: string): number | null {
  if (!MONEY.test(text)) return null;
  const [whole = "0", cents = "00"] = text.split(".");
  return Number.parseInt(whole, 10) * 100 + Number.parseInt(cents, 10);
}

/** 8000 → "80.00". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Hundredths of an hour → "2.25". */
export function formatHundredths(hundredths: number): string {
  return formatCents(hundredths);
}

/**
 * A decimal numeral exactly as Kill Bill wrote it ("91.37", "160.0", "-5") → cents,
 * rounded half up at the third decimal.
 */
export function decimalTextToCents(text: string): number {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!m) throw new Error(`not a decimal amount: ${text}`);
  const digits = (m[3] ?? "").padEnd(3, "0");
  const thousandths = Number.parseInt(m[2] ?? "0", 10) * 1000 + Number.parseInt(digits.slice(0, 3), 10);
  const cents = Math.trunc((thousandths + 5) / 10);
  return m[1] === "-" ? -cents : cents;
}
