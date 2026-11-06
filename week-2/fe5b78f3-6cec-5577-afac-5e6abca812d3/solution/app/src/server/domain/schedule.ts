// Chart time, the chart instant, booking windows and journey complete (brief: Booking windows, Chart time).
import type { ClassCode, Quota, Window } from "../../shared/api.js";
import { HOUR_MS, addDays, istInstant } from "./clock.js";
import type { Stop, Train } from "./catalog.js";

export function departureAt(runDate: string, stop: Stop): number {
  return istInstant(runDate, stop.minutes);
}

/** Trains leaving their origin 14:01 through 05:00 chart 10 hours ahead; 05:01 through 14:00, 8 hours ahead. */
export function chartAt(train: Train, runDate: string): number {
  const origin = train.stops[0];
  if (!origin) throw new Error(`train ${train.number} has no stops`);
  const minuteOfDay = origin.minutes % 1440;
  const lead = minuteOfDay >= 14 * 60 + 1 || minuteOfDay <= 5 * 60 ? 10 : 8;
  return departureAt(runDate, origin) - lead * HOUR_MS;
}

/** From `chart_at` itself the run is chart-prepared for every decision, whether or not the chart job has run. */
export function isChartPrepared(now: number, chart: number): boolean {
  return now >= chart;
}

/** General, Ladies and Senior open at 00:00 IST 60 days before the run date; Tatkal the day before, 10:00 (3A) or 11:00 (SL). */
export function opensAt(quota: Quota, cls: ClassCode, runDate: string): number {
  if (quota === "TQ") return istInstant(addDays(runDate, -1), cls === "3A" ? 10 * 60 : 11 * 60);
  return istInstant(addDays(runDate, -60), 0);
}

export function windowOf(now: number, opening: number, chart: number): Window {
  if (isChartPrepared(now, chart)) return "chart_prepared";
  return now >= opening ? "open" : "not_yet_open";
}

export function isJourneyComplete(now: number, arrivalAtTo: number): boolean {
  return now >= arrivalAtTo;
}
