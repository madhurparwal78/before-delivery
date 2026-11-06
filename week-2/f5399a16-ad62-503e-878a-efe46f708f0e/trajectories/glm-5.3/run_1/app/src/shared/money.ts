// Money in minor units: every amount the app shows is a whole number of
// cents, and tax is half up on each milestone on its own. No float is ever
// involved.

export type Currency = "EUR" | "CAD" | "USD";
export const CURRENCIES: Currency[] = ["EUR", "CAD", "USD"];

export function isCurrency(v: string): v is Currency {
  return (CURRENCIES as string[]).includes(v);
}

// Tax percent by the client's place, as an exact rational: 21% Netherlands,
// 13% Ontario, none for New York and Dubai.
export function taxPercentOfPlace(place: string): bigint | null {
  switch (place) {
    case "netherlands":
      return 21n;
    case "ontario":
      return 13n;
    case "newYork":
    case "dubai":
      return null;
    default:
      return null;
  }
}

// Minor units of a whole percent on a minor amount, half up to the cent:
// 183550 at 21% is 38545.5, so 38546.
export function taxOfMilestone(amountMinor: bigint, percent: bigint | null): bigint {
  if (percent === null) return 0n;
  const scaled = amountMinor * percent * 2n;
  const q = scaled / 200n;
  const r = scaled % 200n;
  if (r >= 100n) {
    return q + 1n;
  }
  return q;
}

// A fee splits across three milestones exactly, the earlier ones taking the
// extra cents: 12,500.00 is 4,166.67, 4,166.67 and 4,166.66.
export function splitMilestones(feeMinor: bigint): [bigint, bigint, bigint] {
  const third = feeMinor / 3n;
  const rem = feeMinor - third * 3n;
  if (rem === 0n) return [third, third, third];
  if (rem === 1n) return [third + 1n, third, third];
  return [third + 1n, third + 1n, third];
}

function grouped(amountMinor: bigint, decimal: bigint, mark: string): string {
  const neg = amountMinor < 0n;
  const abs = neg ? -amountMinor : amountMinor;
  const units = abs / decimal;
  const cents = abs % decimal;
  const digits = decimal === 100n ? 2 : 0;
  const unitText = units.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const centsText = cents.toString().padStart(digits, "0");
  const body = digits > 0 ? `${unitText}.${centsText}` : unitText;
  return `${neg ? "-" : ""}${mark}${body}`;
}

// The published amount forms: €1,835.50, CA$1,835.50, US$1,835.50.
export function amountText(currency: Currency, amountMinor: bigint): string {
  switch (currency) {
    case "EUR":
      return grouped(amountMinor, 100n, "€");
    case "CAD":
      return grouped(amountMinor, 100n, "CA$");
    case "USD":
      return grouped(amountMinor, 100n, "US$");
  }
}

// The letter's tax is the sum of the milestones' taxes.
export function totalTaxOf(milestones: bigint[], percent: bigint | null): bigint {
  return milestones.reduce((sum, m) => sum + taxOfMilestone(m, percent), 0n);
}
