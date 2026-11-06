// Money is integer micro-credits (BigInt) from input to storage. One credit is 1,000,000 micro-credits.

export const MICRO = 1_000_000n;

/** The integer nearest numerator/denominator, ties away from zero (half up). `denominator` is positive. */
export function roundHalfUp(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  const remainder = numerator % denominator;
  const twice = 2n * (remainder < 0n ? -remainder : remainder);
  if (twice < denominator) return quotient;
  return numerator < 0n ? quotient - 1n : quotient + 1n;
}

/** Units (held as micro-units, units × 1,000,000) times a rate, computed exactly and rounded once. */
export function amountFor(unitsMicro: bigint, microPerUnit: bigint): bigint {
  return roundHalfUp(unitsMicro * microPerUnit, MICRO);
}

function grouped(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

/** Credits with two decimals, half up, comma thousands: 3,180.00 */
export function formatCredits(micro: bigint): string {
  const cents = roundHalfUp(micro, 10_000n);
  const sign = cents < 0n ? "-" : "";
  const abs = cents < 0n ? -cents : cents;
  return `${sign}${grouped((abs / 100n).toString())}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** A rate per unit with six decimals: 8.500000 */
export function formatRate(microPerUnit: bigint): string {
  return `${microPerUnit / MICRO}.${(microPerUnit % MICRO).toString().padStart(6, "0")}`;
}

/** A whole number of credits with comma thousands: 1,000 */
export function formatWholeCredits(credits: number): string {
  return grouped(String(credits));
}

const RATE_MIN_MICRO = 1n;
const RATE_MAX_MICRO = 1_000_000n * MICRO;

/**
 * Reads "New rate (credits per unit)": digits with an optional decimal point, at most six decimals, no
 * separators, 0.000001 to 1000000 inclusive. Returns micro-credits per unit exactly, or null.
 */
export function parseRateInput(text: string): bigint | null {
  const match = /^(\d*)(?:\.(\d{0,6}))?$/.exec(text.trim());
  if (!match || (match[1] === "" && !match[2])) return null;
  const micro = BigInt(match[1] || "0") * MICRO + BigInt((match[2] ?? "").padEnd(6, "0"));
  return micro >= RATE_MIN_MICRO && micro <= RATE_MAX_MICRO ? micro : null;
}

/** US dollars for a whole number of credits (100 credits per dollar), two decimals. */
export function usdFor(credits: number): string {
  return `${Math.trunc(credits / 100)}.${String(credits % 100).padStart(2, "0")}`;
}
