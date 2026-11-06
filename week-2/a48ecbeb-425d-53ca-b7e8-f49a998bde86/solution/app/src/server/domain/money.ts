// Integer-cent arithmetic (adapted from kit/modules/money). No floating point touches an amount.

/** num / den rounded half up (ties away from zero) for non-negative integers. */
export function roundHalfUp(num: number, den: number): number {
  const quotient = Math.floor(num / den);
  const remainder = num - quotient * den;
  return remainder * 2 >= den ? quotient + 1 : quotient;
}

/**
 * Largest-remainder allocation of `total` over integer `weights`: each part takes the whole-cent
 * part of total × weight ÷ Σweights, and leftover cents go one each to the largest fractional
 * parts, ties to the earlier index. Parts always sum to `total` (when Σweights > 0).
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const parts = weights.map((w) => Math.floor((total * w) / sum));
  const remainders = weights.map((w, i) => (total * w) - parts[i] * sum);
  let left = total - parts.reduce((a, b) => a + b, 0);
  const order = remainders
    .map((r, i) => ({ r, i }))
    .sort((a, b) => b.r - a.r || a.i - b.i);
  for (const { i } of order) {
    if (left === 0) break;
    parts[i] += 1;
    left -= 1;
  }
  return parts;
}

/** Tax rates are stored in thousandths of a percent: 9.975% is 9975. */
export const RATE_DENOMINATOR = 100_000;

export function rateLabel(milli: number): string {
  const whole = Math.floor(milli / 1000);
  const frac = String(milli % 1000).padStart(3, "0");
  return `${whole}.${frac}`;
}
