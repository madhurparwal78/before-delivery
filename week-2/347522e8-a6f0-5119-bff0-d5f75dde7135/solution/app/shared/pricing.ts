// The hour price, defined once: the server debits it and the board's draft shows it.

import { SLOT_MINUTES, addDays, wallClockInstant, wallClockOf } from "./kitchenTime.js";

interface StationRate {
  hour_weight: number;
  off_peak_percent: number;
}

const OFF_PEAK_FROM = 22 * 60;
const OFF_PEAK_UNTIL = 6 * 60;
const SLOT_MS = SLOT_MINUTES * 60_000;

/** A slot is off-peak when its kitchen wall-clock start is at or after 22:00 or before 06:00. */
function isOffPeakSlot(minuteOfDay: number): boolean {
  return minuteOfDay >= OFF_PEAK_FROM || minuteOfDay < OFF_PEAK_UNTIL;
}

/**
 * Minutes debited for a booking from instant `from` to `until`: the sum over its real elapsed
 * 15-minute slots, peak slots at 15 × weight and off-peak slots at 15 × weight × percent ÷ 100,
 * rounded up once.
 */
export function priceBetween(from: number, until: number, rate: StationRate): number {
  let hundredths = 0;
  for (let slot = from; slot < until; slot += SLOT_MS) {
    const percent = isOffPeakSlot(wallClockOf(slot).minuteOfDay) ? rate.off_peak_percent : 100;
    hundredths += SLOT_MINUTES * rate.hour_weight * percent;
  }
  return Math.ceil(hundredths / 100);
}

/** The price of a booking given by kitchen date and wall-clock minutes; null when a time does not exist. */
function bookingPrice(date: string, start: number, end: number, rate: StationRate): number | null {
  const from = wallClockInstant(date, start);
  const until = wallClockInstant(date, end);
  return from === null || until === null ? null : priceBetween(from, until, rate);
}

/** The weekly series dates starting at `date`. */
export function seriesDates(date: string, weeks: number): string[] {
  return Array.from({ length: weeks }, (_, week) => addDays(date, week * 7));
}

/** A series costs the sum of its weeks' rounded prices, each week priced by its own real slots. */
export function seriesPrice(date: string, start: number, end: number, rate: StationRate, weeks: number): number | null {
  let total = 0;
  for (const day of seriesDates(date, weeks)) {
    const price = bookingPrice(day, start, end, rate);
    if (price === null) return null;
    total += price;
  }
  return total;
}
