import { CURRENCY_DECIMALS, Cur, CurrencyTable } from './types';

/** Half-up division of non-negative integers: floor((2a + b) / (2b)). */
export function roundDiv(a: number, b: number): number {
  return Math.floor((2 * a + b) / (2 * b));
}

/** Half-up rounding of x * p / 100 on non-negative integers. */
export function pctOf(x: number, p: number): number {
  return roundDiv(x * p, 100);
}

/** x minus p percent of x, rounded once. */
export function off(x: number, p: number): number {
  return x - pctOf(x, p);
}

function roundDivBig(a: bigint, b: bigint): bigint {
  return (2n * a + b) / (2n * b);
}

const HUNDRED = 100n;
const MILLION = 1000000n;

function scale(cur: Cur): bigint {
  return 10n ** BigInt(CURRENCY_DECIMALS[cur]);
}

/** Converted amount of a single EUR-cent sum. */
export function convertTotal(eurMinor: number, cur: Cur, rates: CurrencyTable): number {
  const num = BigInt(eurMinor) * BigInt(rates[cur]) * scale(cur);
  return Number(roundDivBig(num, HUNDRED * MILLION));
}

/**
 * Converts a total and splits it across nights so the nights add up exactly:
 * each night takes the whole part of its exact share, and the units still
 * missing go one each to the nights with the largest fractional parts,
 * ties to the earlier night.
 */
export function convertSplit(nightsEurMinor: number[], cur: Cur, rates: CurrencyTable): { total: number; nights: number[] } {
  const denom = HUNDRED * MILLION;
  const factor = BigInt(rates[cur]) * scale(cur);
  let sum = 0n;
  const floors: bigint[] = [];
  const rems: bigint[] = [];
  for (const a of nightsEurMinor) {
    const num = BigInt(a) * factor;
    sum += num;
    floors.push(num / denom);
    rems.push(num % denom);
  }
  const total = roundDivBig(sum, denom);
  let assigned = floors.reduce((acc, v) => acc + v, 0n);
  const nights = floors.slice();
  let missing = total - assigned;
  const order = nights.map((_, i) => i).sort((i, j) => (rems[i] === rems[j] ? i - j : rems[i] > rems[j] ? -1 : 1));
  let k = 0;
  while (missing > 0n && order.length > 0) {
    const i = order[k % order.length];
    nights[i] += 1n;
    missing -= 1n;
    k += 1;
  }
  assigned = nights.reduce((acc, v) => acc + v, 0n);
  return { total: Number(total), nights: nights.map(Number) };
}

/** Major-unit string of a minor amount, used for formatting. */
export function minorToMajor(minor: number, cur: Cur): number {
  return minor / 10 ** CURRENCY_DECIMALS[cur];
}
