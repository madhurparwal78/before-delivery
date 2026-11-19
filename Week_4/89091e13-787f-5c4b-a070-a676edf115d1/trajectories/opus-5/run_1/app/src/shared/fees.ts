import { SHARE_SIZE } from './shares.js';

export const BASE_GAS = 65000;
export const STAKING_GAS = 80000;
export const UFERN_PER_FERN = 1000000n;

export interface DecimalRate {
  numerator: bigint;
  denominator: bigint;
}

/** Parses a non-negative decimal string into an exact fraction. */
export function parseRate(value: string): DecimalRate {
  const [whole, fraction = ''] = value.trim().split('.');
  const denominator = 10n ** BigInt(fraction.length);
  return { numerator: BigInt(whole + fraction), denominator };
}

export function gasForShares(shares: number): number {
  return BASE_GAS + shares * SHARE_SIZE * 8;
}

/** Fee in ufern = ceil(gas x min gas price), computed as exact integers. */
export function feeForGas(gas: number, minGasPrice: DecimalRate): bigint {
  const numerator = BigInt(gas) * minGasPrice.numerator;
  return (numerator + minGasPrice.denominator - 1n) / minGasPrice.denominator;
}

/** Parses an amount in FERN with at most 6 decimals into ufern. */
export function parseFern(value: string): bigint | null {
  const trimmed = value.trim();
  if (!/^\d+(\.\d{1,6})?$/.test(trimmed)) return null;
  const [whole, fraction = ''] = trimmed.split('.');
  return BigInt(whole) * UFERN_PER_FERN + BigInt(fraction.padEnd(6, '0'));
}
