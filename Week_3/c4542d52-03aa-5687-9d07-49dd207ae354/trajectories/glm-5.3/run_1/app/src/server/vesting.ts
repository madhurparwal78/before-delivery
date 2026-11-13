import { addMonthsClamped, dateDiffDays } from './time.js';
import type { Decimal } from './decimal.js';
import { divRoundHalfUp } from './decimal.js';

export type VestingType = 'standard' | 'monthly';

export interface VestingInputs {
  options: number;
  vestingType: VestingType;
  vestingStart: string; // YYYY-MM-DD
}

export interface Tranche {
  month: number;
  date: string;
  cumulative: number;
  state: 'vested' | 'unvested' | 'cancelled';
  cost_at_strike: string;
  vested_ownership: string;
}

/** Date of vesting mark m: start plus m calendar months, clamped to month end. */
export function markDate(vestingStart: string, m: number): string {
  return addMonthsClamped(vestingStart, m);
}

/** Cumulative options vested at mark m (gross, before exercise/cancellation). */
export function cumulativeAt(inputs: VestingInputs, m: number): number {
  const { options, vestingType } = inputs;
  if (m <= 0) return 0;
  if (vestingType === 'standard' && m < 12) return 0;
  return Math.floor((options * m) / 48);
}

/** The latest mark whose date is on or before the server date; -1 when the start is in the future. */
export function latestVestedMark(inputs: VestingInputs, serverDateStr: string): number {
  for (let m = 48; m >= 1; m--) {
    if (dateDiffDays(serverDateStr, markDate(inputs.vestingStart, m)) >= 0) return m;
  }
  return -1;
}

export function vestedOn(inputs: VestingInputs, serverDateStr: string): number {
  return cumulativeAt(inputs, latestVestedMark(inputs, serverDateStr));
}

export function ownershipPercent(netOptions: number, fullyDilutedTotal: number): string {
  const pct = divRoundHalfUp(BigInt(Math.max(0, netOptions)) * 10_000n, BigInt(fullyDilutedTotal), 2);
  return decimal2(pct.unscaled);
}

export function decimal2(unscaled: bigint): string {
  const sign = unscaled < 0n ? '-' : '';
  const abs = unscaled < 0n ? -unscaled : unscaled;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

export function decimal4(unscaled: bigint): string {
  const sign = unscaled < 0n ? '-' : '';
  const abs = unscaled < 0n ? -unscaled : unscaled;
  return `${sign}${abs / 10_000n}.${(abs % 10_000n).toString().padStart(4, '0')}`;
}

export function centsString(unscaledCents: bigint): string {
  const sign = unscaledCents < 0n ? '-' : '';
  const abs = unscaledCents < 0n ? -unscaledCents : unscaledCents;
  return `${sign}${abs / 100n}.${(abs % 100n).toString().padStart(2, '0')}`;
}

/** Cost of exercising `options` at `strike`, rounded half-up to the cent once, as unscaled cents. */
export function costCents(options: number, strike: Decimal): bigint {
  const opts = BigInt(Math.max(0, options));
  return divRoundHalfUp(opts * strike.unscaled * 100n, 10n ** BigInt(strike.scale), 0).unscaled;
}

/** Cost as a money string with exactly two decimals. */
export function costOf(options: number, strike: Decimal): string {
  return centsString(costCents(options, strike));
}
