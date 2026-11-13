/**
 * The markdown ladder: every markdown price, station instant and station state in the
 * product is decided here, from the server's clock alone.
 */

import {
  addDays,
  startOfBrusselsDay,
  type BrusselsDate,
} from '../../shared/brussels.js';
import { divideHalfUp } from '../../shared/money.js';
import type { StationName, StationState } from '../../shared/options.js';

export interface Ladder {
  id: string;
  effectiveOn: BrusselsDate;
  firstMarkdownPercent: number;
  firstMarkdownDay: number;
  secondMarkdownPercent: number;
  secondMarkdownDay: number;
  periodEndDay: number;
}

/** One asking price and the instant from which it is in force, oldest first. */
export interface AskingPriceWindow {
  askingPriceCents: number;
  effectiveFrom: number;
}

export interface Station {
  station: StationName;
  label: string;
  at: number;
  priceCents: number;
  state: StationState;
}

/** The asking price times the ladder's remaining percentage in integer cents, rounded half up. */
export function markdownPriceCents(askingPriceCents: number, percent: number): number {
  return divideHalfUp(askingPriceCents * (100 - percent), 100);
}

export function stationLabel(station: StationName, ladder: Ladder): string {
  switch (station) {
    case 'full_price':
      return 'Full price';
    case 'off_25':
      return `${ladder.firstMarkdownPercent}% off`;
    case 'off_50':
      return `${ladder.secondMarkdownPercent}% off`;
    case 'period_ends':
      return 'Period ends';
  }
}

function dayOfStation(station: StationName, ladder: Ladder): number {
  switch (station) {
    case 'full_price':
      return 0;
    case 'off_25':
      return ladder.firstMarkdownDay;
    case 'off_50':
      return ladder.secondMarkdownDay;
    case 'period_ends':
      return ladder.periodEndDay;
  }
}

function percentOfStation(station: StationName, ladder: Ladder): number {
  switch (station) {
    case 'full_price':
      return 0;
    case 'off_25':
      return ladder.firstMarkdownPercent;
    case 'off_50':
    case 'period_ends':
      return ladder.secondMarkdownPercent;
  }
}

/** Station instants fall at Brussels local midnight of their day. */
export function stationInstant(
  station: StationName,
  ladder: Ladder,
  intakeDate: BrusselsDate,
): number {
  return startOfBrusselsDay(addDays(intakeDate, dayOfStation(station, ladder)));
}

export function periodEndInstant(ladder: Ladder, intakeDate: BrusselsDate): number {
  return stationInstant('period_ends', ladder, intakeDate);
}

/**
 * The choice is open from 00:00 Brussels on day (period end − 14) until 00:00 Brussels
 * on the period end day.
 */
export function choiceWindow(
  ladder: Ladder,
  intakeDate: BrusselsDate,
): { opensAt: number; closesAt: number } {
  return {
    opensAt: startOfBrusselsDay(addDays(intakeDate, ladder.periodEndDay - 14)),
    closesAt: periodEndInstant(ladder, intakeDate),
  };
}

function askingPriceAt(history: readonly AskingPriceWindow[], at: number): number {
  let inForce = history[0];
  for (const window of history) {
    if (window.effectiveFrom <= at) inForce = window;
  }
  return (inForce ?? history[0] ?? { askingPriceCents: 0 }).askingPriceCents;
}

function stationAt(ladder: Ladder, intakeDate: BrusselsDate, at: number): StationName {
  let current: StationName = 'full_price';
  for (const station of ['off_25', 'off_50', 'period_ends'] as const) {
    if (stationInstant(station, ladder, intakeDate) <= at) current = station;
  }
  return current;
}

export interface PriceContext {
  ladder: Ladder;
  intakeDate: BrusselsDate;
  askingHistory: readonly AskingPriceWindow[];
}

/** The price in force at an instant, by the asking price and ladder in force then. */
export function priceInForceAt(context: PriceContext, at: number): number {
  const station = stationAt(context.ladder, context.intakeDate, at);
  return markdownPriceCents(
    askingPriceAt(context.askingHistory, at),
    percentOfStation(station, context.ladder),
  );
}

/** The four stations with their dates, prices by the asking price in force now, and states. */
export function stationsOf(context: PriceContext, now: number): Station[] {
  const { ladder, intakeDate } = context;
  const askingNow = askingPriceAt(context.askingHistory, now);
  const stations = (['full_price', 'off_25', 'off_50', 'period_ends'] as const).map((station) => ({
    station,
    label: stationLabel(station, ladder),
    at: stationInstant(station, ladder, intakeDate),
    priceCents: markdownPriceCents(askingNow, percentOfStation(station, ladder)),
  }));
  const currentIndex = stations.reduce(
    (latest, entry, index) => (entry.at <= now ? index : latest),
    -1,
  );
  return stations.map((entry, index) => ({
    ...entry,
    state: index === currentIndex ? 'current' : index < currentIndex ? 'done' : 'next',
  }));
}

export function currentStation(context: PriceContext, now: number): StationName {
  return stationAt(context.ladder, context.intakeDate, now);
}

export function currentPriceCents(context: PriceContext, now: number): number {
  return priceInForceAt(context, now);
}

/**
 * The price just before the most recent price change — a markdown step or a price edit —
 * or null when the piece has never changed price.
 */
export function previousPriceCents(context: PriceContext, now: number): number | null {
  const changes: number[] = [];
  for (const station of ['off_25', 'off_50'] as const) {
    const at = stationInstant(station, context.ladder, context.intakeDate);
    if (at <= now) changes.push(at);
  }
  for (const window of context.askingHistory.slice(1)) {
    if (window.effectiveFrom <= now) changes.push(window.effectiveFrom);
  }
  if (changes.length === 0) return null;
  const latest = Math.max(...changes);
  return priceInForceAt(context, latest - 1);
}
