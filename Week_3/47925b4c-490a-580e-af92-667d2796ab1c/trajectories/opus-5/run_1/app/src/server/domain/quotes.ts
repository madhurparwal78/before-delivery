import { divideRoundHalfEven } from './decimal.js';

const FACTOR_PERMILLE: Readonly<Record<number, number>> = {
  1: 1000,
  2: 1800,
  3: 2500,
  4: 3100,
  5: 3600,
  6: 4100,
  7: 4600,
};

export const MIN_HIRE_DAYS = 1;
export const MAX_HIRE_DAYS = 7;
export const VAT_PERCENT = 21;

export interface Quote {
  readonly dayRateCents: number;
  readonly days: number;
  readonly factorPermille: number;
  readonly netCents: number;
  readonly vatCents: number;
  readonly totalCents: number;
  readonly providerTotalCents: number;
  readonly matches: boolean;
}

export function factorPermille(days: number): number {
  return FACTOR_PERMILLE[days] ?? 0;
}

/** The hire quote in integer cents, with one half-even rounding at each stage. */
export function quoteFor(dayRateCents: number, days: number, providerTotalCents: number): Quote {
  const factor = factorPermille(days);
  const netCents = Number(divideRoundHalfEven(BigInt(dayRateCents) * BigInt(factor), 1000n));
  const vatCents = Number(divideRoundHalfEven(BigInt(netCents) * BigInt(VAT_PERCENT), 100n));
  const totalCents = netCents + vatCents;
  return {
    dayRateCents,
    days,
    factorPermille: factor,
    netCents,
    vatCents,
    totalCents,
    providerTotalCents,
    matches: totalCents === providerTotalCents,
  };
}
