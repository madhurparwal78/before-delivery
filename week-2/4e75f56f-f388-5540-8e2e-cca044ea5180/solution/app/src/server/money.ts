// Money is integer cents everywhere; these are the only conversions to and from text.

/** 345000 → "3,450.00" (no dollar sign; copy adds it). */
export function formatDollars(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = Math.abs(cents % 100);
  return `${whole.toLocaleString("en-US")}.${String(rest).padStart(2, "0")}`;
}

/** 345000 → "3450.00", the decimal Kill Bill expects. */
export function toDecimal(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const value = Math.abs(cents);
  return `${sign}${Math.trunc(value / 100)}.${String(value % 100).padStart(2, "0")}`;
}

/** Kill Bill's decimal amount (as it appears in JSON) → integer cents, by digits, never by float maths. */
export function fromDecimal(value: number | string): number {
  const text = String(value);
  const match = /^(-?)(\d+)(?:\.(\d+))?$/.exec(text);
  if (!match) throw new Error(`Unreadable amount ${text}`);
  const fraction = (match[3] ?? "").padEnd(2, "0").slice(0, 2);
  const cents = Number.parseInt(match[2] ?? "0", 10) * 100 + Number.parseInt(fraction, 10);
  return match[1] === "-" ? -cents : cents;
}
