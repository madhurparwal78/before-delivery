// The one rounding rule (brief: Money and rounding): exact integer arithmetic on whole cents, a value
// rounded once, half-up (a half cent goes up). Used by the levelling contingency, retention with its cap
// and the half release.

/** round(numerator / denominator) with halves rounded up, in exact integers. */
export function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const twice = 2n * numerator + denominator;
  const divisor = 2n * denominator;
  const quotient = twice / divisor;
  // BigInt division truncates toward zero; step down for a negative inexact quotient so this is floor.
  return twice % divisor !== 0n && (twice < 0n) !== (divisor < 0n) ? quotient - 1n : quotient;
}

/** `cents × basisPoints / 10,000`, rounded once half-up: a percentage with two decimals of whole cents. */
export const percentOf = (cents: number, basisPoints: number): number =>
  Number(divideHalfUp(BigInt(cents) * BigInt(basisPoints), 10_000n));
