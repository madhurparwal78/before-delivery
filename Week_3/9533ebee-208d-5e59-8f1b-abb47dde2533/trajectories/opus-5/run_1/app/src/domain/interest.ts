/**
 * The kinked borrow-rate curve, the per-second cumulative borrow index and a
 * position's debt read from that index.
 */

import { SECONDS_PER_YEAR } from './assets.ts';

export interface RateCurve {
  readonly baseBps: bigint;
  readonly slope1Bps: bigint;
  readonly kinkBps: bigint;
  readonly slope2Bps: bigint;
}

/** The borrow rate in basis points at a utilization in basis points. */
export function borrowRateBps(utilizationBps: bigint, curve: RateCurve): bigint {
  if (utilizationBps <= curve.kinkBps) {
    return curve.baseBps + (curve.slope1Bps * utilizationBps) / curve.kinkBps;
  }
  return (
    curve.baseBps +
    curve.slope1Bps +
    (curve.slope2Bps * (utilizationBps - curve.kinkBps)) / (10000n - curve.kinkBps)
  );
}

/** Supply rate = floor(borrow rate × U × (10,000 − reserve factor) / 100,000,000). */
export function supplyRateBps(
  borrowRate: bigint,
  utilizationBps: bigint,
  reserveFactorBps: bigint,
): bigint {
  return (borrowRate * utilizationBps * (10000n - reserveFactorBps)) / 100000000n;
}

/**
 * Brings a borrow index forward by `seconds`, using the rate in force at the
 * start of the interval.
 */
export function indexForward(index: bigint, rateBps: bigint, seconds: bigint): bigint {
  if (seconds <= 0n) return index;
  return index + (index * rateBps * seconds) / (10000n * SECONDS_PER_YEAR);
}

/**
 * A position's debt at the current index: ceil(principal × index now /
 * reference index), rounded toward the pool.
 */
export function debtAtIndex(
  principal: bigint,
  referenceIndex: bigint,
  indexNow: bigint,
): bigint {
  if (principal === 0n) return 0n;
  const product = principal * indexNow;
  return product % referenceIndex === 0n
    ? product / referenceIndex
    : product / referenceIndex + 1n;
}
