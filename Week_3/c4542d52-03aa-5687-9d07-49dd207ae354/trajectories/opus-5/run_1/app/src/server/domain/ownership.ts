import { formatPercent } from "./money.js";

export interface OwnershipInput {
  key: string;
  label: string;
  fullyDiluted: number;
}

/**
 * Fully diluted ownership to two decimals by largest remainder, so the column
 * sums to exactly 100.00. Ties go to the row with more fully diluted shares,
 * then to the earlier row.
 */
export function largestRemainder(rows: readonly OwnershipInput[]): Map<string, string> {
  const total = rows.reduce((sum, row) => sum + row.fullyDiluted, 0);
  const result = new Map<string, string>();
  if (total === 0) {
    for (const row of rows) result.set(row.key, formatPercent(0n));
    return result;
  }
  const totalBig = BigInt(total);
  const shares = rows.map((row, index) => {
    const exact = BigInt(row.fullyDiluted) * 10000n;
    return {
      index,
      key: row.key,
      fullyDiluted: row.fullyDiluted,
      floor: exact / totalBig,
      remainder: exact % totalBig,
    };
  });
  const assigned = shares.reduce((sum, share) => sum + share.floor, 0n);
  let missing = 10000n - assigned;
  const order = [...shares].sort((a, b) => {
    if (a.remainder !== b.remainder) return a.remainder > b.remainder ? -1 : 1;
    if (a.fullyDiluted !== b.fullyDiluted) return b.fullyDiluted - a.fullyDiluted;
    return a.index - b.index;
  });
  const bonus = new Set<string>();
  for (const share of order) {
    if (missing <= 0n) break;
    bonus.add(share.key);
    missing -= 1n;
  }
  for (const share of shares) {
    result.set(share.key, formatPercent(share.floor + (bonus.has(share.key) ? 1n : 0n)));
  }
  return result;
}
