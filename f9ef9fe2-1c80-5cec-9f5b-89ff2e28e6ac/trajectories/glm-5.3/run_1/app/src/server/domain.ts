import { quarterOf } from "./kitchenTime";

export interface Cell {
  station_id: string;
  start: string;
}

export interface Line {
  station_id: string;
  station: string;
  tier: number;
  paid_by: "cash" | "pack";
  quarters: number;
  hours: string;
  hourly_rate_cents: number;
  amount_cents: number;
}

export interface Quote {
  month: string;
  month_hours_before: string;
  rate_card_id: string;
  lines: Line[];
  tier_steps_crossed: number[];
  pack_quarters: number;
  quarters: number;
  hours: string;
  total_cents: number;
  total: string;
}

export interface RateCard {
  id: string;
  kitchen_id: string;
  effective_from: string;
  tier_rates_cents: number[];
  station_surcharges_cents: Record<string, number>;
  cancellation_window_hours: number;
  pack_price_cents: number;
  created_at: Date;
}

export interface Station {
  id: string;
  kitchen_id: string;
  name: string;
  kind: "oven" | "mixer" | "chiller" | "prep" | "range" | "kettle" | "cooler";
  loom_order: number;
}

export function formatHours(quarters: number): string {
  return `${Math.floor(quarters / 4)}.${String((quarters % 4) * 25).padStart(2, "0")}`;
}

export function formatMoney(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const whole = Math.floor(abs / 100);
  const frac = String(abs % 100).padStart(2, "0");
  const withCommas = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${withCommas}.${frac}`;
}

export function lineAmountCents(quarters: number, hourlyRateCents: number): number {
  // The single rounding stage: quarters x rate / 4, half up.
  return Math.floor((quarters * hourlyRateCents + 2) / 4);
}

export interface PricedCell {
  station: Station;
  startQ: number;
  tier: number;
  paidBy: "cash" | "pack";
}

/**
 * The tier walk. Cells are ordered by start time, then station loom order; the
 * running count starts at the month-to-date quarters. This is the only place
 * the tier and the rounding are decided.
 */
export function walkCells(orderedCells: Array<{ station: Station; startQ: number }>, monthToDateQuarters: number): PricedCell[] {
  return orderedCells.map((cell) => {
    const c = monthToDateQuarters;
    const tier = c < 32 ? 1 : c < 80 ? 2 : c < 120 ? 3 : 4;
    monthToDateQuarters += 1;
    return { ...cell, tier, paidBy: "cash" as const };
  });
}

export function payWithPack(cells: PricedCell[], packBalanceQuarters: number): PricedCell[] {
  let left = packBalanceQuarters;
  return cells.map((cell) => {
    if (left > 0) {
      left -= 1;
      return { ...cell, paidBy: "pack" as const };
    }
    return cell;
  });
}

export interface PriceCellsInput {
  cells: Array<{ station: Station; startQ: number }>;
  monthToDateQuarters: number;
  packBalanceQuarters: number;
  usePack: boolean;
  rateCard: RateCard;
  month: string;
}

export function priceCells(input: PriceCellsInput): { quote: Quote; priced: PricedCell[] } {
  const ordered = [...input.cells].sort((a, b) => a.startQ - b.startQ || a.station.loom_order - b.station.loom_order);
  const startTier = input.monthToDateQuarters < 32 ? 1 : input.monthToDateQuarters < 80 ? 2 : input.monthToDateQuarters < 120 ? 3 : 4;
  let priced = walkCells(ordered, input.monthToDateQuarters);
  if (input.usePack && input.packBalanceQuarters > 0) {
    priced = payWithPack(priced, input.packBalanceQuarters);
  }

  const groups = new Map<string, { station: Station; tier: number; paidBy: "cash" | "pack"; quarters: number }>();
  for (const cell of priced) {
    const key = `${cell.station.id}|${cell.tier}|${cell.paidBy}`;
    const group = groups.get(key);
    if (group) {
      group.quarters += 1;
    } else {
      groups.set(key, { station: cell.station, tier: cell.tier, paidBy: cell.paidBy, quarters: 1 });
    }
  }
  const lines: Line[] = [...groups.values()]
    .sort((a, b) => a.station.loom_order - b.station.loom_order || a.tier - b.tier || (a.paidBy === b.paidBy ? 0 : a.paidBy === "cash" ? -1 : 1))
    .map((group) => {
      const surcharge = input.rateCard.station_surcharges_cents[group.station.id] ?? 0;
      const hourlyRateCents = input.rateCard.tier_rates_cents[group.tier - 1]! + surcharge;
      return {
        station_id: group.station.id,
        station: group.station.name,
        tier: group.tier,
        paid_by: group.paidBy,
        quarters: group.quarters,
        hours: formatHours(group.quarters),
        hourly_rate_cents: hourlyRateCents,
        amount_cents: group.paidBy === "cash" ? lineAmountCents(group.quarters, hourlyRateCents) : 0,
      };
    });

  const steps: number[] = [];
  let c = input.monthToDateQuarters;
  for (const _cell of ordered) {
    const tier = c < 32 ? 1 : c < 80 ? 2 : c < 120 ? 3 : 4;
    if (tier > startTier && !steps.includes(tier)) {
      steps.push(tier);
    }
    c += 1;
  }

  const packQuarters = priced.filter((cell) => cell.paidBy === "pack").length;
  const total = lines.reduce((sum, line) => sum + line.amount_cents, 0);
  const quote: Quote = {
    month: input.month,
    month_hours_before: formatHours(input.monthToDateQuarters),
    rate_card_id: input.rateCard.id,
    lines,
    tier_steps_crossed: steps,
    pack_quarters: packQuarters,
    quarters: ordered.length,
    hours: formatHours(ordered.length),
    total_cents: total,
    total: formatMoney(total),
  };
  return { quote, priced };
}

export function cellsEqual(a: Cell, b: Cell): boolean {
  return a.station_id === b.station_id && a.start === b.start;
}

export function uniqueCells(cells: Cell[]): Cell[] {
  const seen = new Set<string>();
  return cells.filter((cell) => {
    const key = cellKey(cell);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

export function cellKey(cell: Cell): string {
  return `${cell.station_id}|${cell.start}`;
}

export function cellFromQuarter(stationId: string, q: number): Cell {
  const minutes = 4 * 60 + q * 15;
  const start = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
  return { station_id: stationId, start };
}

export function quarterOfCell(cell: Cell): number {
  return quarterOf(cell.start);
}
