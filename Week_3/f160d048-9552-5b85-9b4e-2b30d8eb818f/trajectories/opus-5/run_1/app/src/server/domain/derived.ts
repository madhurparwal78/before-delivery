/** Round half up on the exact fraction `numerator / denominator`, both integers. */
function roundHalfUpFraction(numerator: number, denominator: number): number {
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

/** The mean of integer ratings, rounded half up to one decimal on the exact mean. */
export function meanToOneDecimal(values: ReadonlyArray<number>): number | null {
  if (values.length === 0) return null;
  const sum = values.reduce((total, value) => total + value, 0);
  return roundHalfUpFraction(sum * 10, values.length) / 10;
}

/**
 * Linear interpolation between closest ranks, the same result as PostgreSQL's
 * `percentile_cont`, rounded half up to whole rupees.
 */
function percentileRupees(sorted: ReadonlyArray<number>, percent: number): number {
  const positionNumerator = percent * (sorted.length - 1);
  const lowerIndex = Math.floor(positionNumerator / 100);
  const remainder = positionNumerator - lowerIndex * 100;
  const lower = sorted[lowerIndex] as number;
  const upper = sorted[Math.min(lowerIndex + 1, sorted.length - 1)] as number;
  return roundHalfUpFraction(lower * 100 + (upper - lower) * remainder, 100);
}

export interface Band {
  low: number;
  median: number;
  high: number;
}

export function bandFromReports(amounts: ReadonlyArray<number>): Band {
  const sorted = [...amounts].sort((a, b) => a - b);
  return {
    low: percentileRupees(sorted, 25),
    median: percentileRupees(sorted, 50),
    high: percentileRupees(sorted, 75),
  };
}
