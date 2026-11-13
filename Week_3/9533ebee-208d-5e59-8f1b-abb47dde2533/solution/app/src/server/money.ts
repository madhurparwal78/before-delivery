// Exact integer money. Every amount is a bigint of minor units; division rounds as each formula states.

import { priceUnits } from "../shared/format.js";

export const BPS = 10_000n;
const MAX_DIGITS = 40;

/** Division rounded up, for a positive denominator. */
export function ceilDiv(numerator: bigint, denominator: bigint): bigint {
  const quotient = numerator / denominator;
  return quotient * denominator === numerator || numerator < 0n ? quotient : quotient + 1n;
}

/** A whole number of minor units above zero, written as a digit string with no leading zeros. */
export function parseAmount(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length > MAX_DIGITS || !/^[1-9]\d*$/.test(value)) return null;
  return BigInt(value);
}

/** A price above zero with at most 8 decimals, returned in price units (one hundred-millionth of a dollar). */
export function parsePrice(value: unknown): bigint | null {
  if (typeof value !== "string" || value.length > MAX_DIGITS) return null;
  if (!/^\d+(\.\d{1,8})?$/.test(value)) return null;
  const units = priceUnits(value);
  return units > 0n ? units : null;
}

/**
 * Splits `total` between the liquidity providers and the reserve in the ratio (10,000 − reserve factor) to reserve
 * factor, by largest remainder: each side gets the floor of its exact share, a leftover unit goes to the side with
 * the larger fractional remainder, and on a tie to the providers. Returns the reserve side.
 */
export function reserveShare(total: bigint, reserveFactorBps: number): bigint {
  const reserveExact = total * BigInt(reserveFactorBps);
  const supplyExact = total * (BPS - BigInt(reserveFactorBps));
  const reserveFloor = reserveExact / BPS;
  const leftover = total - reserveFloor - supplyExact / BPS;
  return reserveFloor + (leftover > 0n && reserveExact % BPS > supplyExact % BPS ? 1n : 0n);
}

/** A scaled integer shown with a fixed number of decimals, e.g. a health factor ×10,000 → `1.1250`. */
export function fixedText(scaled: bigint, places: number): string {
  const scale = 10n ** BigInt(places);
  return `${scaled / scale}.${(scaled % scale).toString().padStart(places, "0")}`;
}

export function pow10(exponent: number): bigint {
  return 10n ** BigInt(exponent);
}
