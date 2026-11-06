// Money is integer cents end to end. Every computed money line is rounded once, half up, on an exact rational.

const BASIS_POINTS = 10_000;

/** The one rounding rule: numerator ÷ denominator to the nearest integer, a half always rounding up. */
export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number((2n * numerator + denominator) / (2n * denominator));
}

/** Whole-number quotient rounded down, for non-negative integers (contract month, owned percent). */
export function quotientFloor(numerator: number, denominator: number): number {
  return Number(BigInt(numerator) / BigInt(denominator));
}

/** Whole-number quotient rounded up, for non-negative integers (term length). */
export function quotientCeil(numerator: number, denominator: number): number {
  return Number((BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator));
}

/** `amount × rate ÷ 10,000`, rounded once: sales tax on a money line. */
export function applyBasisPoints(cents: number, basisPoints: number): number {
  return roundHalfUp(BigInt(cents) * BigInt(basisPoints), BigInt(BASIS_POINTS));
}

/** "$1,120.50"; negative amounts read "-$76.97". */
export function formatMoney(cents: number): string {
  const value = BigInt(cents);
  const magnitude = value < 0n ? -value : value;
  const dollars = (magnitude / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const rest = (magnitude % 100n).toString().padStart(2, "0");
  return `${value < 0n ? "-" : ""}$${dollars}.${rest}`;
}

/** Plain dollars with two decimals and no grouping ("100.00"): the form Kill Bill and typed fields use. */
export function plainDollars(cents: number): string {
  const value = BigInt(cents);
  return `${value / 100n}.${(value % 100n).toString().padStart(2, "0")}`;
}

/** Typed dollars ("58.46", "58.4", "58") to cents, or null when it is not a plain amount. */
export function parseDollars(text: string): number | null {
  const match = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(text.trim());
  if (!match) return null;
  return Number(BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0")));
}

/** "8.25%" from 825 basis points. */
export function formatTaxPercent(basisPoints: number): string {
  return `${plainDollars(basisPoints)}%`;
}

/** A typed percent with up to two decimals ("8.25") to basis points, or null. */
export function parsePercent(text: string): number | null {
  return parseDollars(text);
}
