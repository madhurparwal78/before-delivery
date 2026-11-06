/**
 * The hour price. This is the only definition of what a booking costs, and it
 * prices both the board's draft in the browser and the booking on the server.
 */

import {
  SLOT_MINUTES,
  SLOT_MS,
  addDays,
  kitchenMinuteOfDay,
  resolveKitchenWallClock,
} from './kitchenTime.js';

export const OFF_PEAK_EVENING_FROM_MINUTE = 22 * 60;
export const OFF_PEAK_MORNING_UNTIL_MINUTE = 6 * 60;
export const MAX_BOOKING_MINUTES = 6 * 60;
export const MIN_BOOKING_MINUTES = SLOT_MINUTES;
export const MAX_REPEAT_WEEKS = 12;

export interface StationRate {
  hourWeight: number;
  offPeakPercent: number;
}

/** A slot is off-peak when its kitchen wall-clock start is at or after 22:00 or before 06:00. */
export function isOffPeakSlot(slotStartMs: number): boolean {
  const minuteOfDay = kitchenMinuteOfDay(slotStartMs);
  return (
    minuteOfDay >= OFF_PEAK_EVENING_FROM_MINUTE || minuteOfDay < OFF_PEAK_MORNING_UNTIL_MINUTE
  );
}

export type SpanResolution =
  | { kind: 'ok'; startMs: number; endMs: number }
  | { kind: 'skipped'; field: 'start' | 'end' };

/** Turns one booking week's date and wall-clock range into real instants. */
export function resolveSpan(date: string, start: string, end: string): SpanResolution {
  const startResolved = resolveKitchenWallClock(date, start);
  if (startResolved.kind === 'skipped') return { kind: 'skipped', field: 'start' };
  const endResolved =
    end === '24:00'
      ? resolveKitchenWallClock(addDays(date, 1), '00:00')
      : resolveKitchenWallClock(date, end);
  if (endResolved.kind === 'skipped') return { kind: 'skipped', field: 'end' };
  return { kind: 'ok', startMs: startResolved.instantMs, endMs: endResolved.instantMs };
}

/**
 * The minutes one booking debits: the sum over its real elapsed 15-minute
 * slots, off-peak slots discounted, rounded up once to a whole minute.
 */
export function priceSpanMinutes(startMs: number, endMs: number, rate: StationRate): number {
  let total = 0;
  for (let slot = startMs; slot < endMs; slot += SLOT_MS) {
    const peakCost = SLOT_MINUTES * rate.hourWeight;
    total += isOffPeakSlot(slot) ? (peakCost * rate.offPeakPercent) / 100 : peakCost;
  }
  return Math.ceil(total);
}

/** The kitchen dates of each week of a series, keeping the same weekday. */
export function seriesDates(date: string, repeatWeeks: number): string[] {
  const dates: string[] = [];
  for (let week = 0; week < repeatWeeks; week += 1) dates.push(addDays(date, week * 7));
  return dates;
}

export type SeriesPrice =
  | { kind: 'ok'; weeks: { date: string; startMs: number; endMs: number; minutes: number }[]; totalMinutes: number }
  | { kind: 'skipped'; field: 'start' | 'end'; date: string };

/**
 * Prices every week of a series, each by its own real slots, and totals the
 * per-week rounded prices.
 */
export function priceSeries(
  date: string,
  start: string,
  end: string,
  repeatWeeks: number,
  rate: StationRate,
): SeriesPrice {
  const weeks: { date: string; startMs: number; endMs: number; minutes: number }[] = [];
  let totalMinutes = 0;
  for (const weekDate of seriesDates(date, repeatWeeks)) {
    const span = resolveSpan(weekDate, start, end);
    if (span.kind === 'skipped') return { kind: 'skipped', field: span.field, date: weekDate };
    const minutes = priceSpanMinutes(span.startMs, span.endMs, rate);
    weeks.push({ date: weekDate, startMs: span.startMs, endMs: span.endMs, minutes });
    totalMinutes += minutes;
  }
  return { kind: 'ok', weeks, totalMinutes };
}
