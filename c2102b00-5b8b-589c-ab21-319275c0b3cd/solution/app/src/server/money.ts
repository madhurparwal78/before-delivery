// Money is integer cents. Text becomes cents and cents become text by digit arithmetic only.

const DOLLARS = /^\$?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/;

/** Dollars as a member types them (`19.99`, `$250.5`, `1,000`) to cents, or null when malformed. */
export function dollarTextToCents(text: string): number | null {
  const match = DOLLARS.exec(text.trim());
  if (!match) return null;
  const whole = match[1]!.replaceAll(",", "");
  const fraction = (match[2] ?? "").padEnd(2, "0");
  return Number(BigInt(whole) * 100n + BigInt(fraction));
}

/** Cents to the dollar amount Kill Bill takes: `1999` → `19.99`. */
export function centsToDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}${Math.trunc(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** A decimal amount Kill Bill returned (`19.99`, `45`, `45.5`) to cents. */
export function decimalToCents(text: string): number {
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text.trim());
  if (!match) return Number.NaN;
  const fraction = (match[3] ?? "").padEnd(2, "0");
  if (/[1-9]/.test(fraction.slice(2))) return Number.NaN;
  const cents = Number(match[2]) * 100 + Number(fraction.slice(0, 2));
  return match[1] ? -cents : cents;
}

/** `$1,234.56` for people. */
export function formatMoney(cents: number): string {
  const whole = Math.trunc(Math.abs(cents) / 100).toLocaleString("en-US");
  return `${cents < 0 ? "-" : ""}$${whole}.${String(Math.abs(cents) % 100).padStart(2, "0")}`;
}

export const TOPUP_MIN_CENTS = 500;
export const TOPUP_MAX_CENTS = 50_000;
