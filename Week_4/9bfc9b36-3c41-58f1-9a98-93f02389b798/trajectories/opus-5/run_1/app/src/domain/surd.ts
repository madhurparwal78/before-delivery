/**
 * Exact rounding of the quantities the crosscut construction needs.
 * Every one of them has the shape (p·√S + q) ÷ r with whole p, q, r and S,
 * so the half-away-from-zero rounding is decided by whole-number comparisons
 * alone and never by a floating-point value.
 */

import { roundHalfAway } from '../shared/units';

/** The whole part of √S, rounded half away from zero. */
export function roundSquareRoot(s: bigint): bigint {
  const floor = integerSquareRoot(s);
  return s <= floor * floor + floor ? floor : floor + 1n;
}

export function integerSquareRoot(s: bigint): bigint {
  if (s < 2n) return s;
  let guess = BigInt(Math.floor(Math.sqrt(Number(s))));
  if (guess < 1n) guess = 1n;
  while (guess * guess > s) guess -= 1n;
  while ((guess + 1n) * (guess + 1n) <= s) guess += 1n;
  return guess;
}

/** True when m ≤ (p·√S + q) ÷ r, for non-negative p and positive r. */
function atMost(m: bigint, p: bigint, q: bigint, r: bigint, s: bigint): boolean {
  const left = m * r - q; // compare left ≤ p·√S
  if (left <= 0n) return true;
  return left * left <= p * p * s;
}

/**
 * Rounds (p·√S + q) ÷ r half away from zero. The construction only ever asks
 * for non-negative values with non-negative p and positive r.
 */
export function roundSurd(p: bigint, q: bigint, r: bigint, s: bigint): number {
  if (p === 0n) return roundHalfAway(q, r);
  let floor = BigInt(Math.floor((Number(p) * Math.sqrt(Number(s)) + Number(q)) / Number(r)));
  if (floor < 0n) floor = 0n;
  while (!atMost(floor, p, q, r, s)) floor -= 1n;
  while (atMost(floor + 1n, p, q, r, s)) floor += 1n;
  // Round up when the remainder is a half or more:
  // value − floor ≥ 1/2  ⟺  2·p·√S ≥ r·(2·floor + 1) − 2·q
  const threshold = r * (2n * floor + 1n) - 2n * q;
  if (threshold <= 0n) return Number(floor + 1n);
  const roundsUp = 4n * p * p * s >= threshold * threshold;
  return Number(roundsUp ? floor + 1n : floor);
}

/** The smallest whole n with n·w ≥ √S, for positive w. */
export function ceilSquareRootOver(s: bigint, w: bigint): number {
  let n = BigInt(Math.ceil(Math.sqrt(Number(s)) / Number(w)));
  if (n < 1n) n = 1n;
  while (n * n * w * w < s) n += 1n;
  while (n > 1n && (n - 1n) * (n - 1n) * w * w >= s) n -= 1n;
  return Number(n);
}
