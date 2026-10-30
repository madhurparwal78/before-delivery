/**
 * Whole-cent arithmetic. The one published rounding rule lives here: round once,
 * to the cent, half-up, so a half cent goes up.
 */

export const MAX_CENTS = 99_999_999_999;

function floorDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return numerator % denominator !== 0n && numerator < 0n ? quotient - 1n : quotient;
}

/** Rounds numerator ÷ denominator to a whole number, half-up. */
export function roundHalfUp(numerator: bigint, denominator: bigint): number {
  return Number(floorDiv(numerator * 2n + denominator, denominator * 2n));
}

/** value × percent ÷ 100, where percent carries at most two decimal places. */
export function percentOfCents(cents: number, percent: string): number {
  return roundHalfUp(BigInt(cents) * BigInt(percentHundredths(percent)), 10_000n);
}

export function percentHundredths(percent: string): number {
  const [whole = '0', fraction = ''] = percent.split('.');
  return Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
}

export function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

/** Halves an amount of cents, rounded once, half-up. */
export function halfOfCents(cents: number): number {
  return roundHalfUp(BigInt(cents), 2n);
}
