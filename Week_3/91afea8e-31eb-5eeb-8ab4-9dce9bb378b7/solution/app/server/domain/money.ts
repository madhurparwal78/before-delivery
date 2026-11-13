/** Integer paise only. `roundHalfUp` is the one rounding rule: half up, applied once at the end of a value's calculation. */
export function roundHalfUp(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** Largest-remainder split: parts add up to `total`, leftover paise go to the largest dropped fractions, ties to the earlier index. */
export function allocate(total: number, weights: readonly number[]): number[] {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum === 0) return weights.map(() => 0);
  const parts = weights.map((weight) => Math.floor((total * weight) / sum));
  const order = weights
    .map((weight, index) => ({ index, remainder: (total * weight) % sum }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  let leftover = total - parts.reduce((a, b) => a + b, 0);
  for (const { index } of order) {
    if (leftover === 0) break;
    parts[index] = (parts[index] ?? 0) + 1;
    leftover -= 1;
  }
  return parts;
}

/** Whole rupees with two decimals, for the payment ledger boundary only. */
export function ledgerAmount(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, "0")}`;
}
