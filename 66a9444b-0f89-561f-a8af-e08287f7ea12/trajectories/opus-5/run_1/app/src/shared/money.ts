/**
 * The published allocation rule, used both to compute an order and to preview it in checkout.
 *
 * Spreads `total` across `weights` in whole cents: each slot takes the whole-cent part of its exact
 * proportional share, then the leftover cents go one at a time to the largest dropped fractions,
 * ties to the earlier position.
 */
export function allocate(total: number, weights: readonly number[]): number[] {
  const weightSum = weights.reduce((sum, weight) => sum + weight, 0);
  if (total <= 0 || weightSum <= 0) return weights.map(() => 0);

  const shares = weights.map((weight) => Math.floor((total * weight) / weightSum));
  const remainders = weights.map(
    (weight, index) => (total * weight) / weightSum - (shares[index] as number),
  );
  let left = total - shares.reduce((sum, share) => sum + share, 0);

  const order = weights
    .map((_, index) => index)
    .sort((a, b) => {
      const difference = (remainders[b] as number) - (remainders[a] as number);
      return difference !== 0 ? difference : a - b;
    });

  for (const index of order) {
    if (left <= 0) break;
    shares[index] = (shares[index] as number) + 1;
    left -= 1;
  }
  return shares;
}

/** Rounds half up to the cent, as the group discount rule requires. */
export function percentOf(amountCents: number, percent: number): number {
  return Math.floor((amountCents * percent) / 100 + 0.5);
}
