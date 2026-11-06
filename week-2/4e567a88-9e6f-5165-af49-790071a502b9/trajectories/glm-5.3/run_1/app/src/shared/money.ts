// Integer micro-credit money and the single rounding rule of the domain.
// One credit is 1,000,000 micro-credits.

/** Round a non-negative rational (numerator ÷ denominator) half-up to a whole micro-credit. */
export function microFromRatio(num: bigint, den: bigint): number {
  if (den <= 0n) throw new Error("microFromRatio: denominator must be positive");
  return Number((2n * num + den) / (2n * den));
}

/** units × micro_per_unit, rounded once, half-up. */
export function microForUnits(unitsNum: bigint, unitsDen: bigint, microPerUnit: number): number {
  return microFromRatio(unitsNum * BigInt(microPerUnit), unitsDen);
}

/** Credits displayed with two decimals and comma thousands separators, e.g. "3,180.00". */
export function formatCredits(micro: number): string {
  const cents = Math.round(micro / 10000);
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100).toString();
  const frac = (abs % 100).toString().padStart(2, "0");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}

/** A rate displayed with six decimals, e.g. "3.333333". */
export function formatRate(microPerUnit: number): string {
  return (microPerUnit / 1_000_000).toFixed(6);
}

/** Whole credits with comma separators, no decimals, e.g. "1,000". */
export function formatWholeCredits(credits: number): string {
  return Math.round(credits).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

