// Station metrics for a requested span: the one definition the floor API and the browser stack use.

import { clockText, HALF_HOUR, MINUTE_MS, OPENS_MINUTE, CLOSES_MINUTE, zonedInstant } from "./clock.js";

export interface Occupancy {
  start: number;
  end: number;
  bufferEnd: number;
}

interface SpanMetrics {
  occupiedMinutes: number;
  bufferMinutes: number;
  freeMinutes: number;
}

export type StationState = "free" | "partial" | "full";

export const EXTRUSION_PX = 96;

/** Minutes of [from, to) covered by the union of the given periods. */
function coveredMinutes(periods: readonly (readonly [number, number])[], from: number, to: number): number {
  const clipped = periods
    .map(([low, high]) => [Math.max(low, from), Math.min(high, to)] as const)
    .filter(([low, high]) => high > low)
    .sort((a, b) => a[0] - b[0]);
  let total = 0;
  let reach = from;
  for (const [low, high] of clipped) {
    const begin = Math.max(low, reach);
    if (high > begin) total += high - begin;
    reach = Math.max(reach, high);
  }
  return Math.round(total / MINUTE_MS);
}

/**
 * occupiedMinutes: span minutes covered by any occupied period (start to bufferEnd).
 * bufferMinutes: the part of those that falls only in cleanup buffers.
 * freeMinutes: the span minus occupiedMinutes.
 */
export function stationMetrics(bookings: readonly Occupancy[], from: number, to: number): SpanMetrics {
  const span = Math.round((to - from) / MINUTE_MS);
  const occupied = coveredMinutes(bookings.map((b) => [b.start, b.bufferEnd] as const), from, to);
  const booked = coveredMinutes(bookings.map((b) => [b.start, b.end] as const), from, to);
  return { occupiedMinutes: occupied, bufferMinutes: occupied - booked, freeMinutes: span - occupied };
}

export function stationState(metrics: SpanMetrics): StationState {
  if (metrics.occupiedMinutes === 0) return "free";
  return metrics.freeMinutes === 0 ? "full" : "partial";
}

/** Whole pixels for a share of the span's minutes, an exact half rounding up. */
function pixels(minutes: number, metrics: SpanMetrics): number {
  return Math.round((minutes / (metrics.occupiedMinutes + metrics.freeMinutes)) * EXTRUSION_PX);
}

/** The extrusion target: occupied share of the span times 96. */
export function extrusion(metrics: SpanMetrics): number {
  return pixels(metrics.occupiedMinutes, metrics);
}

/** The cleanup band inside the extrusion: the share of the span that is only cleanup buffer. */
export function bandHeight(metrics: SpanMetrics): number {
  return pixels(metrics.bufferMinutes, metrics);
}

/**
 * The cooler strip: for each half hour of a kitchen date, how many shelves have no occupied period
 * (cleanup buffer included) overlapping it by any length. Server floor answers and the browser share it.
 */
export function coolerFreeRows(shelves: readonly (readonly Occupancy[])[], date: string, zone: string): { time: string; freeShelves: number }[] {
  const rows: { time: string; freeShelves: number }[] = [];
  for (let minute = OPENS_MINUTE; minute < CLOSES_MINUTE; minute += HALF_HOUR) {
    const from = zonedInstant(date, minute, zone);
    const to = zonedInstant(date, minute + HALF_HOUR, zone);
    const freeShelves = shelves.filter((periods) => !periods.some((p) => p.start < to && p.bufferEnd > from)).length;
    rows.push({ time: clockText(minute), freeShelves });
  }
  return rows;
}

const BAR_UNITS = 160;

/** A usage bar's extruded height in drawing units: round(160 × minutes ÷ largest), an exact half rounding up. */
export function usageBarHeight(minutes: number, largest: number): number {
  return largest === 0 ? 0 : Math.floor((2 * BAR_UNITS * minutes + largest) / (2 * largest));
}
