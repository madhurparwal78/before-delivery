/**
 * Reading the third-party price oracle: the published body shape, the
 * mantissa-and-exponent conversion to price units, and the one ladder that
 * decides whether a reading is applied and what status it reports.
 */

import type { Asset } from './assets.ts';

export const ORACLE_STATUSES = [
  'ok',
  'unreachable',
  'malformed',
  'old_round',
  'not_newer',
  'large_move',
  'evidence_unavailable',
] as const;

export type OracleStatus = (typeof ORACLE_STATUSES)[number];

export interface OracleReading {
  readonly round: number;
  readonly priceUnits: bigint;
  /** The publication instant, in epoch milliseconds. */
  readonly publishedAtMs: number;
  /** The response body exactly as received, kept as price evidence. */
  readonly rawBody: string;
}

const MANTISSA = /^[1-9][0-9]{0,37}$/;

function isWholeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

/**
 * Converts a mantissa and exponent to price units with integer arithmetic
 * only. A converted price of zero is malformed, so this returns null for it.
 */
export function convertToPriceUnits(mantissa: bigint, exponent: number): bigint | null {
  const price =
    exponent >= -8
      ? mantissa * 10n ** BigInt(8 + exponent)
      : mantissa / 10n ** BigInt(-8 - exponent);
  return price === 0n ? null : price;
}

/**
 * Reads a response body into a reading, or returns null when the body is not
 * the published shape, the feed is not `<ASSET>-USD`, or the publication is
 * more than 5 seconds after server now.
 */
export function parseOracleBody(
  rawBody: string,
  asset: Asset,
  nowMs: number,
): OracleReading | null {
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return null;
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return null;
  const record = body as Record<string, unknown>;

  if (record['feed'] !== `${asset}-USD`) return null;
  if (!isWholeNumber(record['round']) || record['round'] <= 0) return null;
  if (!isWholeNumber(record['publish_time']) || record['publish_time'] <= 0) return null;

  const price = record['price'];
  if (typeof price !== 'object' || price === null || Array.isArray(price)) return null;
  const priceRecord = price as Record<string, unknown>;

  const mantissa = priceRecord['mantissa'];
  if (typeof mantissa !== 'string' || !MANTISSA.test(mantissa)) return null;
  const exponent = priceRecord['exponent'];
  if (!isWholeNumber(exponent) || exponent < -18 || exponent > 0) return null;

  const priceUnits = convertToPriceUnits(BigInt(mantissa), exponent);
  if (priceUnits === null) return null;

  const publishedAtMs = record['publish_time'] * 1000;
  if (publishedAtMs > nowMs + 5000) return null;

  return { round: record['round'], priceUnits, publishedAtMs, rawBody };
}

/**
 * A move of more than 60% from the current price, in either direction. Exactly
 * 60% is not a large move. Shared by oracle readings and manual posts.
 */
export function isLargeMove(currentPrice: bigint, nextPrice: bigint): boolean {
  const difference =
    nextPrice > currentPrice ? nextPrice - currentPrice : currentPrice - nextPrice;
  return difference * 100n > currentPrice * 60n;
}

/** What the server knows about an asset's price when a reading arrives. */
export interface PriceStanding {
  /** The current posted price, in price units. */
  readonly currentPrice: bigint;
  /** When the current price was published, in epoch milliseconds. */
  readonly currentPostedAtMs: number;
  /** True when the current price is itself an oracle post. */
  readonly currentIsOracle: boolean;
  /** The last oracle round applied for this asset, if any. */
  readonly lastAppliedRound: number | null;
  /** The price that round applied, in price units. */
  readonly lastAppliedPrice: bigint | null;
  /** When that round was published, in epoch milliseconds. */
  readonly lastAppliedPublishedAtMs: number | null;
}

export type OracleDecision =
  | { readonly apply: true; readonly status: 'ok' }
  | { readonly apply: false; readonly status: Exclude<OracleStatus, 'evidence_unavailable'> };

/**
 * The acceptance ladder. A reading is applied only when it is strictly newer
 * by round and by publication time than the current price, so a manual post
 * holds until a later publication arrives.
 */
export function decideOracleReading(
  reading: OracleReading,
  standing: PriceStanding,
): OracleDecision {
  const { lastAppliedRound } = standing;

  if (lastAppliedRound !== null) {
    if (reading.round < lastAppliedRound) return { apply: false, status: 'old_round' };
    if (reading.round === lastAppliedRound) {
      const samePrice = standing.lastAppliedPrice === reading.priceUnits;
      const samePublication = standing.lastAppliedPublishedAtMs === reading.publishedAtMs;
      if (!samePrice || !samePublication) return { apply: false, status: 'old_round' };
      const currentIsThisReading =
        standing.currentIsOracle && standing.currentPrice === reading.priceUnits;
      return currentIsThisReading
        ? { apply: false, status: 'ok' }
        : { apply: false, status: 'not_newer' };
    }
  }

  if (reading.publishedAtMs <= standing.currentPostedAtMs) {
    return { apply: false, status: 'not_newer' };
  }

  if (isLargeMove(standing.currentPrice, reading.priceUnits)) {
    return { apply: false, status: 'large_move' };
  }

  return { apply: true, status: 'ok' };
}
