import { RangeChangeRow, RangeRowRecord } from '../data';
import { query, queryOne } from '../db';
import { MarkerDefinition } from '../shared/catalog';
import { Decimal } from '../shared/money';
import { AgeBand, RangeRow } from './flags';

export interface RangesInForce {
  effectiveFrom: string;
  rows: RangeRow[];
}

function toRangeRow(record: RangeRowRecord): RangeRow {
  return {
    sex: record.sex,
    ageBand: record.age_band,
    low: record.low,
    high: record.high,
    optimalLow: record.optimal_low,
    optimalHigh: record.optimal_high,
  };
}

/** The six rows for a marker in force on a Phoenix date. */
export async function rangesInForce(marker: string, onDate: string): Promise<RangesInForce> {
  const change = await queryOne<RangeChangeRow>(
    `select * from range_changes
     where marker = $1 and effective_from <= $2
     order by effective_from desc limit 1`,
    [marker, onDate],
  );
  if (!change) throw new Error(`No ranges in force for ${marker} on ${onDate}`);
  const rows = await query<RangeRowRecord>(
    'select * from range_rows where change_id = $1 order by sex, age_band',
    [change.id],
  );
  return { effectiveFrom: change.effective_from, rows: rows.map(toRangeRow) };
}

export async function rangeFor(
  marker: string,
  onDate: string,
  sex: 'female' | 'male',
  ageBand: AgeBand,
): Promise<{ effectiveFrom: string; row: RangeRow }> {
  const inForce = await rangesInForce(marker, onDate);
  const row = inForce.rows.find((entry) => entry.sex === sex && entry.ageBand === ageBand);
  if (!row) throw new Error(`No ${sex} ${ageBand} range for ${marker} on ${onDate}`);
  return { effectiveFrom: inForce.effectiveFrom, row };
}

/** A band scale that fits every zone and value of the marker's draws. */
export function bandScale(
  marker: MarkerDefinition,
  values: string[],
  ranges: RangeRow[],
): { min: string; max: string } {
  let top = new Decimal(0);
  for (const range of ranges) top = Decimal.max(top, new Decimal(range.high));
  for (const value of values) top = Decimal.max(top, new Decimal(value));
  const max = top.times('1.3').toDecimalPlaces(marker.decimals, Decimal.ROUND_CEIL);
  return {
    min: new Decimal(0).toFixed(marker.decimals),
    max: max.toFixed(marker.decimals),
  };
}
