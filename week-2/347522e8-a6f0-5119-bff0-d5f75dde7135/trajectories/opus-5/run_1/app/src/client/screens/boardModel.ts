/**
 * The board's reckoning: where a block sits on a wall-clock rail, and how far
 * a draft may legally extend. The price itself comes from the shared pricing
 * module, so the browser never shows a figure the server would not charge.
 */

import {
  SLOT_MINUTES,
  kitchenDate,
  kitchenHhmm,
  kitchenMinuteOfDay,
  minutesToHhmm,
  resolveKitchenWallClock,
} from '../../shared/kitchenTime.js';
import { MAX_BOOKING_MINUTES, priceSeries } from '../../shared/pricing.js';
import { formatHours } from '../../shared/format.js';
import type { StopReason } from '../../shared/copy.js';
import type { Station, StationBlock } from '../../shared/types.js';

export const DAY_MINUTES = 1440;
export const CELLS = DAY_MINUTES / SLOT_MINUTES;
/** The ticket height rule: 12 pixels for every 15 minutes, capped at six hours. */
export const PIXELS_PER_SLOT = 12;
export const MAX_TICKET_HEIGHT = (MAX_BOOKING_MINUTES / SLOT_MINUTES) * PIXELS_PER_SLOT;

export function hhmmOfMinute(minute: number): string {
  return minute >= DAY_MINUTES ? '24:00' : minutesToHhmm(minute);
}

/** Where an instant falls on the shown day's wall-clock rail, in minutes. */
export function minuteOnDay(date: string, instantIso: string): number {
  const ms = Date.parse(instantIso);
  const day = kitchenDate(ms);
  const minute = kitchenMinuteOfDay(ms);
  if (day === date) return minute;
  return day > date ? minute + DAY_MINUTES : minute - DAY_MINUTES;
}

export function instantOfMinute(date: string, minute: number): number | null {
  const resolved = resolveKitchenWallClock(date, hhmmOfMinute(minute));
  return resolved.kind === 'ok' ? resolved.instantMs : null;
}

/** The wall-clock minutes a spring-forward day skips. */
export function skippedMinutes(date: string): Set<number> {
  const skipped = new Set<number>();
  for (let minute = 0; minute < DAY_MINUTES; minute += SLOT_MINUTES) {
    if (resolveKitchenWallClock(date, minutesToHhmm(minute)).kind === 'skipped') {
      skipped.add(minute);
    }
  }
  return skipped;
}

export function ticketHeight(spanMinutes: number): number {
  return Math.min(MAX_TICKET_HEIGHT, (spanMinutes / SLOT_MINUTES) * PIXELS_PER_SLOT);
}

export interface PlacedBlock {
  block: StationBlock;
  startMinute: number;
  endMinute: number;
  bufferEndMinute: number;
}

export function placeBlocks(date: string, station: Station): PlacedBlock[] {
  return station.blocks.map((block) => ({
    block,
    startMinute: minuteOnDay(date, block.starts_at),
    endMinute: minuteOnDay(date, block.ends_at),
    bufferEndMinute: minuteOnDay(date, block.buffer_ends_at),
  }));
}

export interface DraftLimits {
  maxEndMinute: number;
  reason: StopReason | null;
  /** Where the colliding range begins, for the notch. */
  notchMinute: number | null;
}

export interface LimitInput {
  date: string;
  station: Station;
  startMinute: number;
  repeatWeeks: number;
  balanceMinutes: number;
  /** Blocks to measure against, with the draft's own prior hold excluded. */
  placed: readonly PlacedBlock[];
}

function collisionAt(
  input: LimitInput,
  startMs: number,
  endMs: number,
): PlacedBlock | null {
  const occupiedEnd = endMs + input.station.buffer_minutes * 60_000;
  let earliest: PlacedBlock | null = null;
  for (const placed of input.placed) {
    const blockStart = Date.parse(placed.block.starts_at);
    const blockEnd = Date.parse(placed.block.buffer_ends_at);
    if (startMs < blockEnd && blockStart < occupiedEnd) {
      if (earliest === null || blockStart < Date.parse(earliest.block.starts_at)) earliest = placed;
    }
  }
  return earliest;
}

export function seriesMinutes(input: LimitInput, endMinute: number): number | null {
  const priced = priceSeries(
    input.date,
    hhmmOfMinute(input.startMinute),
    hhmmOfMinute(endMinute),
    input.repeatWeeks,
    { hourWeight: input.station.hour_weight, offPeakPercent: input.station.off_peak_percent },
  );
  return priced.kind === 'ok' ? priced.totalMinutes : null;
}

/**
 * The last legal step for a draft, and why it stops there. Collisions win over
 * the plain limits at the same step, because only they draw a notch.
 */
export function draftLimits(input: LimitInput): DraftLimits {
  const startMs = instantOfMinute(input.date, input.startMinute);
  if (startMs === null) {
    return { maxEndMinute: input.startMinute, reason: null, notchMinute: null };
  }
  let legal = input.startMinute;
  for (let end = input.startMinute + SLOT_MINUTES; end <= DAY_MINUTES; end += SLOT_MINUTES) {
    const endMs = instantOfMinute(input.date, end);
    if (endMs === null) continue;

    const collision = collisionAt(input, startMs, endMs);
    if (collision !== null) {
      // `booking` when the requested range meets the other booking's own time,
      // `buffer` when it meets only its sanitation tail.
      const ourOccupiedEnd = endMs + input.station.buffer_minutes * 60_000;
      const meetsOwnTime =
        startMs < Date.parse(collision.block.ends_at) &&
        Date.parse(collision.block.starts_at) < ourOccupiedEnd;
      const reason: StopReason =
        collision.block.kind === 'maintenance'
          ? { kind: 'maintenance', at: hhmmOfMinute(collision.startMinute) }
          : meetsOwnTime
            ? { kind: 'booking', at: hhmmOfMinute(collision.startMinute) }
            : { kind: 'buffer', until: hhmmOfMinute(collision.bufferEndMinute) };
      return {
        maxEndMinute: legal,
        reason,
        notchMinute: collision.startMinute,
      };
    }
    if (endMs - startMs > MAX_BOOKING_MINUTES * 60_000) {
      return { maxEndMinute: legal, reason: { kind: 'max_length' }, notchMinute: null };
    }
    const price = seriesMinutes(input, end);
    if (price !== null && price > input.balanceMinutes) {
      return {
        maxEndMinute: legal,
        reason: { kind: 'balance', hours: formatHours(input.balanceMinutes) },
        notchMinute: null,
      };
    }
    legal = end;
  }
  return { maxEndMinute: legal, reason: { kind: 'day_end' }, notchMinute: null };
}

/** The wall-clock time a draft's sanitation buffer runs until. */
export function bufferEndHhmm(date: string, endMinute: number, bufferMinutes: number): string {
  const endMs = instantOfMinute(date, endMinute);
  if (endMs === null) return hhmmOfMinute(endMinute);
  return kitchenHhmm(endMs + bufferMinutes * 60_000);
}
