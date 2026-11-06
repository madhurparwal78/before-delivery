// The sweep's rules on the board: where a draft may start, how far its end edge may go, and why
// it stops. Occupancy and the price come from the shared definitions the server also uses.

import type { BlockView, StationView } from "../../../shared/api.js";
import { MINUTES_PER_DAY, SLOT_MINUTES, formatHHMM, wallClockInstant, wallMinutesFrom } from "../../../shared/kitchenTime.js";
import { MAX_BOOKING_MINUTES, type OccupiedRange, firstCollision } from "../../../shared/occupancy.js";
import { seriesPrice } from "../../../shared/pricing.js";
import { copy } from "../../copy.js";

const STEP_PX = 12;
const MAX_TICKET_PX = 288;

export interface Draft {
  stationId: string;
  start: number;
  end: number;
  /** sweeping: being drawn; pending: hold request sent; waiting: shrunk after a lost claim. */
  phase: "sweeping" | "pending" | "waiting";
  notchAt: number | null;
}

export interface SweepContext {
  date: string;
  station: StationView;
  weeks: number;
  balance: number;
  /** Wall-clock minute of the server's now on the shown day (−1 on a later day, past 24:00 on an earlier one). */
  nowMinute: number;
}

/** A ticket's height: 12px per 15 minutes of its span, capped at the six-hour height. */
export function ticketHeight(start: number, end: number): number {
  return Math.min(MAX_TICKET_PX, Math.max(STEP_PX, ((end - start) / SLOT_MINUTES) * STEP_PX));
}

/** The station's occupied ranges on the shown day, in wall-clock minutes from its 00:00. */
function occupiedOn(date: string, blocks: readonly BlockView[]): OccupiedRange[] {
  return blocks.map((block) => ({
    kind: block.kind === "maintenance" ? "maintenance" : "booking",
    start: wallMinutesFrom(date, Date.parse(block.starts_at)),
    end: wallMinutesFrom(date, Date.parse(block.ends_at)),
    occupiedEnd: wallMinutesFrom(date, Date.parse(block.buffer_ends_at)),
  }));
}

function exists(date: string, minute: number): boolean {
  return wallClockInstant(date, minute) !== null;
}

export function draftPrice(context: SweepContext, start: number, end: number): number | null {
  return seriesPrice(context.date, start, end, context.station, context.weeks);
}

type Stop =
  | { kind: "conflict"; reason: string; notchAt: number }
  | { kind: "limit"; reason: string };

/** Why the end edge cannot move to `end`, or null when it can. */
function stopAt(context: SweepContext, start: number, end: number): Stop | null {
  if (end - start > MAX_BOOKING_MINUTES) return { kind: "limit", reason: copy.sweep.reasons.sixHours };
  if (end > MINUTES_PER_DAY) return { kind: "limit", reason: copy.sweep.reasons.dayEnd };
  const collision = firstCollision(occupiedOn(context.date, context.station.blocks), start, end + context.station.buffer_minutes);
  if (collision) {
    const { range } = collision;
    const reason =
      collision.blockedBy === "maintenance"
        ? copy.sweep.reasons.maintenance(formatHHMM(range.start))
        : collision.blockedBy === "booking"
          ? copy.sweep.reasons.booking(formatHHMM(range.start))
          : copy.sweep.reasons.buffer(formatHHMM(range.occupiedEnd));
    return { kind: "conflict", reason, notchAt: Math.max(range.start, start) };
  }
  const price = draftPrice(context, start, end);
  if (price !== null && price > context.balance) return { kind: "limit", reason: copy.sweep.reasons.balance(context.balance) };
  return null;
}

/** Whether a press at `start` may drop a stub there. */
export function canStart(context: SweepContext, start: number): "ok" | "taken" | "balance" {
  if (start < context.nowMinute || start >= MINUTES_PER_DAY || !exists(context.date, start)) return "taken";
  const stop = stopAt(context, start, start + SLOT_MINUTES);
  if (stop?.kind === "conflict") return "taken";
  return stop ? "balance" : "ok";
}

interface Step {
  end: number;
  stop: Stop | null;
}

/**
 * Moves the end edge toward `wanted`, one 15-minute step at a time, stopping at the last legal
 * step. Ends that do not exist (the skipped spring hour) are passed over, never landed on.
 */
export function stepToward(context: SweepContext, start: number, wanted: number): Step {
  let end = start + SLOT_MINUTES;
  for (let next = end + SLOT_MINUTES; next <= Math.max(wanted, end); next += SLOT_MINUTES) {
    if (!exists(context.date, next) && next < MINUTES_PER_DAY) {
      const stop = stopAt(context, start, next);
      if (stop) return { end, stop };
      continue;
    }
    const stop = stopAt(context, start, next);
    if (stop) return { end, stop };
    end = next;
  }
  return { end, stop: null };
}

/** The last end at or before `end` whose series price the balance covers, or null when none does. */
export function fitBalance(context: SweepContext, start: number, end: number): number | null {
  for (let candidate = end; candidate > start; candidate -= SLOT_MINUTES) {
    const price = draftPrice(context, start, candidate);
    if (price !== null && price <= context.balance) return candidate;
  }
  return null;
}
