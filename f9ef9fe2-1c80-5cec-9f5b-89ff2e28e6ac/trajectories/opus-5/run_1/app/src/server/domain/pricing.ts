import type { Line, Quote } from '../../shared/types.js';
import { formatHours, formatMoney, minutesToHHMM } from '../../shared/format.js';
import { monthOf } from './time.js';

export type Tier = 1 | 2 | 3 | 4;

export interface StationRef {
  id: string;
  name: string;
  order: number;
}

export interface RateCardRecord {
  id: string;
  effective_from: string;
  tier_rates_cents: [number, number, number, number];
  station_surcharges_cents: Record<string, number>;
  cancellation_window_hours: number;
  pack_price_cents: number;
}

export interface CellRef {
  station_id: string;
  start_minute: number;
}

export interface PricedCell extends CellRef {
  tier: Tier;
  paid_by: 'cash' | 'pack';
}

export interface Priced {
  cells: PricedCell[];
  lines: Line[];
  tier_steps_crossed: number[];
  pack_quarters: number;
  quarters: number;
  total_cents: number;
}

/** Tier 1 covers the first 8 booked hours of a kitchen month, tier 2 hours 8 to
 * 20, tier 3 hours 20 to 30 and tier 4 everything after 30. */
export function tierForQuarterCount(count: number): Tier {
  if (count < 32) return 1;
  if (count < 80) return 2;
  if (count < 120) return 3;
  return 4;
}

/** quarters x hourly rate / 4, rounded half up to a whole cent. The only
 * rounding stage in the whole system. */
export function cashLineAmountCents(quarters: number, hourlyRateCents: number): number {
  const scaled = quarters * hourlyRateCents;
  const whole = Math.floor(scaled / 4);
  return scaled - whole * 4 >= 2 ? whole + 1 : whole;
}

export function sortCells(cells: readonly CellRef[], stations: Map<string, StationRef>): CellRef[] {
  return [...cells].sort((a, b) => {
    if (a.start_minute !== b.start_minute) return a.start_minute - b.start_minute;
    const left = stations.get(a.station_id);
    const right = stations.get(b.station_id);
    return (left ? left.order : 0) - (right ? right.order : 0);
  });
}

export function hourlyRateCents(
  rateCard: RateCardRecord,
  stationId: string,
  tier: Tier,
): number {
  return rateCard.tier_rates_cents[tier - 1] + (rateCard.station_surcharges_cents[stationId] ?? 0);
}

export function priceCells(input: {
  cells: readonly CellRef[];
  stations: Map<string, StationRef>;
  rateCard: RateCardRecord;
  monthQuartersBefore: number;
  packQuartersAvailable: number;
}): Priced {
  const ordered = sortCells(input.cells, input.stations);
  const startingTier = tierForQuarterCount(input.monthQuartersBefore);
  const stepsCrossed = new Set<number>();
  const priced: PricedCell[] = ordered.map((cell, index) => {
    const tier = tierForQuarterCount(input.monthQuartersBefore + index);
    if (tier > startingTier) stepsCrossed.add(tier);
    return {
      station_id: cell.station_id,
      start_minute: cell.start_minute,
      tier,
      paid_by: index < input.packQuartersAvailable ? 'pack' : 'cash',
    };
  });

  const groups = new Map<string, { cell: PricedCell; quarters: number }>();
  for (const cell of priced) {
    const key = `${cell.station_id}|${cell.tier}|${cell.paid_by}`;
    const existing = groups.get(key);
    if (existing) existing.quarters += 1;
    else groups.set(key, { cell, quarters: 1 });
  }

  const lines: Line[] = [...groups.values()]
    .sort((a, b) => {
      const left = input.stations.get(a.cell.station_id);
      const right = input.stations.get(b.cell.station_id);
      const byStation = (left ? left.order : 0) - (right ? right.order : 0);
      if (byStation !== 0) return byStation;
      if (a.cell.tier !== b.cell.tier) return a.cell.tier - b.cell.tier;
      return a.cell.paid_by === b.cell.paid_by ? 0 : a.cell.paid_by === 'cash' ? -1 : 1;
    })
    .map(({ cell, quarters }) => {
      const rate = hourlyRateCents(input.rateCard, cell.station_id, cell.tier);
      const station = input.stations.get(cell.station_id);
      return {
        station_id: cell.station_id,
        station: station ? station.name : cell.station_id,
        tier: cell.tier,
        paid_by: cell.paid_by,
        quarters,
        hours: formatHours(quarters),
        hourly_rate_cents: rate,
        amount_cents: cell.paid_by === 'cash' ? cashLineAmountCents(quarters, rate) : 0,
      };
    });

  return {
    cells: priced,
    lines,
    tier_steps_crossed: [...stepsCrossed].sort((a, b) => a - b),
    pack_quarters: priced.filter((cell) => cell.paid_by === 'pack').length,
    quarters: priced.length,
    total_cents: lines.reduce((sum, line) => sum + line.amount_cents, 0),
  };
}

export function toQuote(priced: Priced, date: string, monthQuartersBefore: number, rateCardId: string): Quote {
  return {
    month: monthOf(date),
    month_hours_before: formatHours(monthQuartersBefore),
    rate_card_id: rateCardId,
    lines: priced.lines,
    tier_steps_crossed: priced.tier_steps_crossed,
    pack_quarters: priced.pack_quarters,
    quarters: priced.quarters,
    hours: formatHours(priced.quarters),
    total_cents: priced.total_cents,
    total: formatMoney(priced.total_cents),
  };
}

/** Contiguous per-station runs of a cell set, for booking blocks. */
export function cellBlocks(
  cells: readonly CellRef[],
  stations: Map<string, StationRef>,
): { station_id: string; station: string; start: string; end: string; hours: string }[] {
  const byStation = new Map<string, number[]>();
  for (const cell of cells) {
    const list = byStation.get(cell.station_id);
    if (list) list.push(cell.start_minute);
    else byStation.set(cell.station_id, [cell.start_minute]);
  }
  const blocks: { station_id: string; station: string; start: string; end: string; hours: string }[] = [];
  const stationIds = [...byStation.keys()].sort(
    (a, b) => (stations.get(a)?.order ?? 0) - (stations.get(b)?.order ?? 0),
  );
  for (const stationId of stationIds) {
    const minutes = (byStation.get(stationId) ?? []).sort((a, b) => a - b);
    let runStart = minutes[0];
    let previous = minutes[0];
    for (const minute of minutes.slice(1)) {
      if (minute !== previous + 15) {
        blocks.push(makeBlock(stationId, stations, runStart, previous + 15));
        runStart = minute;
      }
      previous = minute;
    }
    blocks.push(makeBlock(stationId, stations, runStart, previous + 15));
  }
  return blocks;
}

function makeBlock(
  stationId: string,
  stations: Map<string, StationRef>,
  startMinute: number,
  endMinute: number,
): { station_id: string; station: string; start: string; end: string; hours: string } {
  const station = stations.get(stationId);
  return {
    station_id: stationId,
    station: station ? station.name : stationId,
    start: minutesToHHMM(startMinute),
    end: minutesToHHMM(endMinute),
    hours: formatHours((endMinute - startMinute) / 15),
  };
}
