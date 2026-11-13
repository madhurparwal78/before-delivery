/**
 * Integer-only arithmetic for amounts, prices and indexes. No floating-point
 * value ever holds an amount, price, index or oracle mantissa.
 */

export interface ReserveSplit {
  readonly toSupply: bigint;
  readonly toReserve: bigint;
}

/**
 * Splits a fee or accrual between the liquidity providers and the reserve in
 * the ratio (10,000 − reserve factor) to reserve factor, by largest remainder.
 * Each side takes the floor of its exact share; a leftover unit goes to the
 * side with the larger fractional remainder, and to `supply` on a tie.
 */
export function splitWithReserve(total: bigint, reserveFactorBps: bigint): ReserveSplit {
  const supplyWeight = 10000n - reserveFactorBps;
  const supplyFloor = (total * supplyWeight) / 10000n;
  const reserveFloor = (total * reserveFactorBps) / 10000n;
  const leftover = total - supplyFloor - reserveFloor;
  if (leftover === 0n) {
    return { toSupply: supplyFloor, toReserve: reserveFloor };
  }
  const supplyRemainder = (total * supplyWeight) % 10000n;
  const reserveRemainder = (total * reserveFactorBps) % 10000n;
  if (reserveRemainder > supplyRemainder) {
    return { toSupply: supplyFloor, toReserve: reserveFloor + leftover };
  }
  return { toSupply: supplyFloor + leftover, toReserve: reserveFloor };
}
