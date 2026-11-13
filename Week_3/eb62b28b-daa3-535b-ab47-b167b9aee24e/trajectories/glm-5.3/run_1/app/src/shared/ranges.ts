import { MARKER_BY_ID } from "./markers.js";
import type { Flag } from "./enums.js";
import { dec, roundHalfUp } from "./money.js";
import type { Decimal } from "decimal.js";

export type RangeRowInput = {
  sex: string;
  ageBand: string;
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
};

export type RangeRow = {
  sex: "female" | "male";
  ageBand: "age18To39" | "age40To59" | "age60Plus";
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
};

export type RangeTableVersion = {
  id: string;
  marker: string;
  effectiveFrom: string;
  createdAt: string;
  createdBy: string;
  rows: RangeRow[];
};

/**
 * Flag a value against a range row: bounds inclusive at the marker's decimals.
 * This is the single place in the source that decides a flag.
 */
export function flagFor(
  value: string,
  row: { low: string; high: string; optimalLow: string; optimalHigh: string },
  decimals: number
): Flag {
  const v = roundHalfUp(value, decimals);
  const low = roundHalfUp(row.low, decimals);
  const high = roundHalfUp(row.high, decimals);
  const optimalLow = roundHalfUp(row.optimalLow, decimals);
  const optimalHigh = roundHalfUp(row.optimalHigh, decimals);
  if (v.gte(optimalLow) && v.lte(optimalHigh)) return "optimal";
  if (v.gte(low) && v.lte(high)) return "inRange";
  if (v.lt(low)) return "belowRange";
  return "aboveRange";
}

/** Convert a lab value to the practice unit exactly, then round half up to the marker's decimals. */
export function convertLabValue(
  sourceValue: string,
  factor: string,
  divide: boolean,
  decimals: number
): Decimal {
  const value = dec(sourceValue);
  const f = dec(factor);
  const converted = divide ? value.dividedBy(f) : value.times(f);
  return roundHalfUp(converted, decimals);
}

export function formatRangeString(row: {
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
}): string {
  return `${row.low}–${row.high} (optimal ${row.optimalLow}–${row.optimalHigh})`;
}

/** Bounds validation: low ≤ optimal low ≤ optimal high ≤ high. */
export function rangeBoundsValid(row: {
  low: string;
  high: string;
  optimalLow: string;
  optimalHigh: string;
}): boolean {
  const low = dec(row.low);
  const high = dec(row.high);
  const optimalLow = dec(row.optimalLow);
  const optimalHigh = dec(row.optimalHigh);
  return low.lte(optimalLow) && optimalLow.lte(optimalHigh) && optimalHigh.lte(high);
}

export function markerDecimals(markerId: string): number {
  return MARKER_BY_ID.get(markerId)?.decimals ?? 2;
}

/** Scale min/max that fit every zone and value of a marker's draws. */
export function scaleFor(
  values: string[],
  ranges: { low: string; high: string; optimalLow: string; optimalHigh: string }[]
): { min: string; max: string } {
  let min = dec(Infinity as unknown as string);
  let max = dec(-Infinity as unknown as string);
  const push = (raw: string) => {
    const d = dec(raw);
    if (d.lt(min)) min = d;
    if (d.gt(max)) max = d;
  };
  for (const row of ranges) {
    push(row.low);
    push(row.high);
    push(row.optimalLow);
    push(row.optimalHigh);
  }
  for (const value of values) push(value);
  if (!min.isFinite()) min = dec(0);
  if (!max.isFinite()) max = dec(0);
  if (max.lte(min)) max = min.plus(dec(1));
  return { min: min.toString(), max: max.toString() };
}
