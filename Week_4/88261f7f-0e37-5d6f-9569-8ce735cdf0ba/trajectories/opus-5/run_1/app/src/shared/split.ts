const MIN_SPLIT_SHARES = 2;
export const MAX_SPLIT_SHARES = 4;

export function arePercentsValid(percents: unknown): percents is number[] {
  if (!Array.isArray(percents)) return false;
  if (percents.length < MIN_SPLIT_SHARES || percents.length > MAX_SPLIT_SHARES) return false;
  if (!percents.every((value) => typeof value === 'number' && Number.isInteger(value) && value > 0)) {
    return false;
  }
  return percents.reduce((sum: number, value: number) => sum + value, 0) === 100;
}

/**
 * Each share rounded down, with the remainder cents handed out one at a time
 * in letter order starting with the first share.
 */
export function splitShares(amountCents: number, percents: number[]): number[] {
  const shares = percents.map((percent) => Math.floor((amountCents * percent) / 100));
  let remainder = amountCents - shares.reduce((sum, share) => sum + share, 0);
  for (let index = 0; remainder > 0; index = (index + 1) % shares.length) {
    shares[index] += 1;
    remainder -= 1;
  }
  return shares;
}
