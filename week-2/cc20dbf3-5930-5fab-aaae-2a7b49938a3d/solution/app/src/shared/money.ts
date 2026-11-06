// Money is integer cents end to end. These are the only places an amount becomes dollars:
// display (`formatMoney`), the damage-charge field (`centsFromDollarInput`, `billingAmount`) and
// the billing amount sent to Kill Bill (`billingAmount`).

function splitCents(cents: number): { sign: string; dollars: string; rest: string } {
  const digits = String(Math.abs(cents)).padStart(3, "0");
  return { sign: cents < 0 ? "-" : "", dollars: digits.slice(0, -2), rest: digits.slice(-2) };
}

/** `<money>`: `$1,234.50`; negative amounts read `-$50.00`. */
export function formatMoney(cents: number): string {
  const { sign, dollars, rest } = splitCents(cents);
  return `${sign}$${dollars.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}.${rest}`;
}

/** A plain decimal amount for billing records and the damage-charge field: `50.00`. */
export function billingAmount(cents: number): string {
  const { sign, dollars, rest } = splitCents(cents);
  return `${sign}${dollars}.${rest}`;
}

/** Whole cents from a dollars-and-cents entry (`30`, `30.5`, `30.00`, `$1,030.00`), or null. */
export function centsFromDollarInput(input: string): number | null {
  const match = /^\$?(\d{1,3}(?:,\d{3})*|\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const dollars = (match[1] ?? "").replaceAll(",", "");
  const rest = (match[2] ?? "").padEnd(2, "0");
  return Number.parseInt(`${dollars}${rest}`, 10);
}
