/**
 * The API's own value formats, which are not the desk formats. Amounts and
 * share counts are decimal strings of minor units, prices carry exactly 8
 * decimals, health factors exactly 4 and share prices exactly 12.
 */

import { PRICE_DECIMALS } from './assets.ts';
import { SHARE_PRICE_DECIMALS } from './pool.ts';

/** A fixed-point string from a scaled integer, keeping the sign. */
function fixedPoint(scaled: bigint, decimals: number): string {
  const negative = scaled < 0n;
  const magnitude = negative ? -scaled : scaled;
  const scale = 10n ** BigInt(decimals);
  const whole = magnitude / scale;
  const fraction = (magnitude % scale).toString().padStart(decimals, '0');
  return `${negative ? '-' : ''}${whole.toString()}.${fraction}`;
}

/** An amount or share count: a base-10 integer of minor units. */
export function apiAmount(units: bigint): string {
  return units.toString();
}

/** A price in US dollars with a point and exactly 8 decimals. */
export function apiPrice(priceUnits: bigint): string {
  return fixedPoint(priceUnits, PRICE_DECIMALS);
}

/** A health factor with exactly 4 decimals, or null with no debt. */
export function apiHealthFactor(scaled: bigint | null): string | null {
  return scaled === null ? null : fixedPoint(scaled, 4);
}

/** A share price with exactly 12 decimals. */
export function apiSharePrice(scaled: bigint): string {
  return fixedPoint(scaled, SHARE_PRICE_DECIMALS);
}

/**
 * A duration in ISO 8601, using only H, M and S with zero parts left out:
 * `PT5M`, `PT1H`, `PT20S`, `PT1M30S`, and `PT0S` for zero.
 */
export function apiDuration(totalSeconds: number): string {
  if (totalSeconds === 0) return 'PT0S';
  const hours = Math.trunc(totalSeconds / 3600);
  const minutes = Math.trunc((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let out = 'PT';
  if (hours > 0) out += `${hours}H`;
  if (minutes > 0) out += `${minutes}M`;
  if (seconds > 0) out += `${seconds}S`;
  return out;
}

/** Reads a request price string: digits with an optional point and 1 to 8 decimals. */
const PRICE_REQUEST = /^(0|[1-9][0-9]*)(?:\.([0-9]{1,8}))?$/;

export function parseApiPrice(text: string): bigint | null {
  const match = PRICE_REQUEST.exec(text);
  if (match === null) return null;
  const [, whole, fraction] = match;
  if (whole === undefined) return null;
  const scaled =
    BigInt(whole) * 10n ** BigInt(PRICE_DECIMALS) +
    BigInt((fraction ?? '').padEnd(PRICE_DECIMALS, '0'));
  return scaled <= 0n ? null : scaled;
}

/** Reads a request amount: digits only, above zero, with no leading zeros. */
const AMOUNT_REQUEST = /^[1-9][0-9]*$/;

export function parseApiAmount(text: string): bigint | null {
  return AMOUNT_REQUEST.test(text) ? BigInt(text) : null;
}
