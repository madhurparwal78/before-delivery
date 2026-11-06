// Money is integer US cents end to end; these conversions never pass through floating point.

/** 12345 → "123.45", 10 → "0.10": the two-decimal form sent to billing and written in the CSV. */
export function centsToDecimal(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const rest = cents % 100;
  return `${whole}.${String(rest).padStart(2, "0")}`;
}

/** `$<amount>` with thousands commas: 10000000 → "$100,000.00". */
export function dollars(cents: number): string {
  return `$${centsToDecimal(cents).replace(/\B(?=(\d{3})+(?!\d))/g, ",")}`;
}

/** Basis points as a percent with two decimals: 3000 → "30.00". */
export function percent(bp: number): string {
  return `${Math.trunc(bp / 100)}.${String(bp % 100).padStart(2, "0")}`;
}

/**
 * Parses a decimal with at most two places ("450.00", "60", "33.3") into hundredths (cents or basis
 * points). Returns null for anything else.
 */
export function parseHundredths(text: string): number | null {
  const m = /^\s*(\d{1,9})(?:\.(\d{1,2}))?\s*$/.exec(text);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] ?? "").padEnd(2, "0"));
}
