/**
 * Integer-cent arithmetic. No floating-point value ever touches an amount:
 * every helper here takes and returns whole cents or whole rate units.
 */

/** Rounds `numerator / denominator` half up. Both must be positive integers. */
export function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** A percent written with three decimals, as its value in thousandths of a percent. */
function rateUnits(rate: string): number {
  const match = /^(\d+)\.(\d{3})$/.exec(rate);
  if (!match) throw new Error(`rate must have three decimals: ${rate}`);
  return Number(match[1]) * 1000 + Number(match[2]);
}

const RATE_SCALE = 100_000;

/** A tax line's cents: its rate applied to `baseCents`, rounded half up once. */
export function taxOn(baseCents: number, rate: string): number {
  return roundHalfUp(baseCents * rateUnits(rate), RATE_SCALE);
}

/**
 * Splits `totalCents` across `weights` by largest remainder: each part takes the
 * whole-cent part of its share and the leftover cents go one each to the parts
 * with the largest fractional parts, ties going to the earlier part.
 */
export function allocateByLargestRemainder(
  totalCents: number,
  weights: readonly number[],
): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightSum <= 0 || totalCents <= 0) return weights.map(() => 0);

  const shares = weights.map((weight) => Math.floor((totalCents * weight) / weightSum));
  const remainders = weights.map((weight, index) => ({
    index,
    remainder: totalCents * weight - shares[index]! * weightSum,
  }));
  let leftover = totalCents - shares.reduce((sum, share) => sum + share, 0);

  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (const entry of remainders) {
    if (leftover <= 0) break;
    shares[entry.index]! += 1;
    leftover -= 1;
  }
  return shares;
}

/** Formats whole cents as dollars with two decimals, without a currency sign. */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

/** Formats whole cents as `$12.34`, with a plain hyphen before the sign when negative. */
export function formatDollars(cents: number): string {
  return cents < 0 ? `-$${formatCents(-cents)}` : `$${formatCents(cents)}`;
}

/** Parses dollars written with up to two decimals into whole cents. */
export function parseDollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const fraction = (match[2] ?? '').padEnd(2, '0');
  return Number(match[1]) * 100 + Number(fraction);
}
