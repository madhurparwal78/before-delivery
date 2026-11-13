// One place for stations, prices and station states (DP-12, DP-15, DP-17, DP-18).

import { markdownPriceCents } from '../shared/money.js';
import { addDays, brusselsMidnight, cutToSecond, toZ } from '../shared/time.js';
import type { StationValue } from '../shared/vocab.js';

export interface Ladder {
  id: string;
  effectiveOn: string;
  firstMarkdownPercent: number;
  firstMarkdownDay: number;
  secondMarkdownPercent: number;
  secondMarkdownDay: number;
  periodEndDay: number;
}

export interface StationJson {
  station: StationValue;
  label: string;
  at: string;
  priceCents: number | null;
  state: 'done' | 'current' | 'next';
}

export interface PriceHistoryEntry {
  askingPriceCents: number;
  effectiveFrom: Date;
}

export function stationLabel(station: StationValue, ladder: Ladder): string {
  switch (station) {
    case 'full_price': return 'Full price';
    case 'off_25': return `${ladder.firstMarkdownPercent}% off`;
    case 'off_50': return `${ladder.secondMarkdownPercent}% off`;
    case 'period_ends': return 'Period ends';
  }
}

/** The UTC instant each station starts at (Brussels local midnight of its day). */
export function stationInstants(ladder: Ladder, intakeDate: string): Record<StationValue, Date> {
  return {
    full_price: brusselsMidnight(intakeDate),
    off_25: brusselsMidnight(addDays(intakeDate, ladder.firstMarkdownDay)),
    off_50: brusselsMidnight(addDays(intakeDate, ladder.secondMarkdownDay)),
    period_ends: brusselsMidnight(addDays(intakeDate, ladder.periodEndDay)),
  };
}

/**
 * The four stations with their states and prices at a given instant.
 * `history` is the piece's asking-price history in order (used to price each
 * station by the asking price in force at that instant).
 */
export function stationsAt(
  ladder: Ladder,
  intakeDate: string,
  now: Date,
  history: PriceHistoryEntry[]
): { stations: StationJson[]; current: StationValue } {
  const instants = stationInstants(ladder, intakeDate);
  const order: StationValue[] = ['full_price', 'off_25', 'off_50', 'period_ends'];
  const nowSec = cutToSecond(now).getTime();

  let currentIdx = 0;
  const stations: StationJson[] = order.map((station, idx) => {
    const at = cutToSecond(instants[station]);
    const asking = priceInForceAt(history, at);
    const priceCents = stationPrice(ladder, station, asking);
    if (at.getTime() <= nowSec) currentIdx = idx;
    return { station, label: stationLabel(station, ladder), at: toZ(at), priceCents, state: 'next' };
  });
  for (let i = 0; i < stations.length; i++) {
    const st = stations[i]!;
    st.state = i < currentIdx ? 'done' : i === currentIdx ? 'current' : 'next';
  }
  return { stations, current: order[currentIdx] ?? 'full_price' };
}

/** The asking price in force at an instant, from the price history. */
export function priceInForceAt(history: PriceHistoryEntry[], at: Date): number | null {
  let current: number | null = null;
  for (const entry of history) {
    if (entry.effectiveFrom.getTime() <= at.getTime()) current = entry.askingPriceCents;
    else break;
  }
  return current;
}

/** Markdown price for a station, half-up rounded, from the asking price at that instant. */
export function stationPrice(ladder: Ladder, station: StationValue, askingPriceCents: number | null): number | null {
  if (askingPriceCents === null) return null;
  switch (station) {
    case 'full_price': return askingPriceCents;
    case 'off_25': return markdownPriceCents(askingPriceCents, ladder.firstMarkdownPercent);
    case 'off_50': return markdownPriceCents(askingPriceCents, ladder.secondMarkdownPercent);
    case 'period_ends': return markdownPriceCents(askingPriceCents, ladder.secondMarkdownPercent);
  }
}

/** currentPriceCents: the price of the current station by the asking price in force now. */
export function currentPriceCents(
  ladder: Ladder,
  intakeDate: string,
  now: Date,
  history: PriceHistoryEntry[]
): number | null {
  const { stations, current } = stationsAt(ladder, intakeDate, now, history);
  const st = stations.find((s) => s.station === current);
  return st?.priceCents ?? null;
}

/** previousPriceCents: the price just before the most recent price change, or null.
 * A price change is a markdown step or a price edit: when the current station's
 * price differs from the previous station's price, the previous station's price
 * is the old price; otherwise the piece has never changed price. */
export function previousPriceCents(
  ladder: Ladder,
  intakeDate: string,
  now: Date,
  history: PriceHistoryEntry[]
): number | null {
  const { stations, current } = stationsAt(ladder, intakeDate, now, history);
  const idx = stations.findIndex((s) => s.station === current);
  const cur = stations[idx];
  const prev = idx > 0 ? stations[idx - 1] : undefined;
  if (!cur || !prev || prev.priceCents === null) return null;
  return cur.priceCents === prev.priceCents ? null : prev.priceCents;
}
