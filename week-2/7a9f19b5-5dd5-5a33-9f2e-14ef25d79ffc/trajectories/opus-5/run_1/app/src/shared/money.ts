/** The one money formatter. Cents in, New Zealand dollars out. */

/** `1234550` -> `1,234.50`. No dollar sign: published copy supplies it. */
export function formatAmount(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const dollars = Math.trunc(abs / 100);
  const remainder = abs % 100;
  const grouped = dollars.toLocaleString("en-NZ", { useGrouping: true });
  return `${negative ? "-" : ""}${grouped}.${remainder.toString().padStart(2, "0")}`;
}

/** `1234550` -> `$1,234.50`. */
export function formatMoney(cents: number): string {
  return `$${formatAmount(cents)}`;
}

/**
 * Parses the dollars-and-cents an admin types into the refund and record-payment
 * dialogs (`277.73`, no dollar sign). Returns null when it is not money.
 */
export function parseAmountToCents(input: string): number | null {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(trimmed)) return null;
  const [whole, fraction = ""] = trimmed.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

/** Kill Bill speaks dollars; the domain speaks cents. */
export function centsToDollars(cents: number): number {
  return Math.round(cents) / 100;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

/** Counts that the app fills in from its own data carry no thousands separator. */
export function formatCount(value: number): string {
  return String(Math.round(value));
}
