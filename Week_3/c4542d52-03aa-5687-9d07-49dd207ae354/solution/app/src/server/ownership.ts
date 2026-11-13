import { formatScaled, floorDivide } from "./decimal.js";

const HUNDREDTHS = 10000;

/** Ownership to two decimals by largest remainder; the strings always add up to 100.00. */
export function largestRemainder(shares: number[]): string[] {
  const total = shares.reduce((sum, value) => sum + value, 0);
  const hundredths = shares.map((value) => floorDivide(value * HUNDREDTHS, total));
  const remainders = shares.map((value) => (value * HUNDREDTHS) % total);
  const missing = HUNDREDTHS - hundredths.reduce((sum, value) => sum + value, 0);
  const order = shares
    .map((_, index) => index)
    .sort((a, b) => (remainders[b] ?? 0) - (remainders[a] ?? 0) || (shares[b] ?? 0) - (shares[a] ?? 0) || a - b);
  for (const index of order.slice(0, missing)) hundredths[index] = (hundredths[index] ?? 0) + 1;
  return hundredths.map((value) => formatScaled(BigInt(value), 2));
}
