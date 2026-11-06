// Booking transitions on the server: the shared transition table for manual actions, and the two
// automatic changes (hold lapse, grace lapse to no-show) that requests and the sweep both apply here.

import type { Db } from "./db.js";
import { config } from "./config.js";
import { ApiError, variantError } from "./http.js";
import { STATUS_WORDS } from "../shared/format.js";
import { nextStatus, type ManualAction, type Status, type TransitionState } from "../shared/rules.js";

/**
 * Applies every hold lapse and grace lapse already due, once, raising `version`: across a kitchen
 * (or every kitchen for the sweep), or for the named bookings. Bookings starting in a closed month
 * never lapse to no-show. Rows another transaction holds are left to that transaction, which
 * applies this itself after taking its lock.
 */
export async function applyDueLapses(db: Db, kitchenId: string | null, bookingIds: string[] | null = null): Promise<void> {
  const scope = "($1::text IS NULL OR b.kitchen_id = $1) AND ($2::text[] IS NULL OR b.id = ANY($2))";
  await db.query(
    `UPDATE bookings SET status = 'expired', version = version + 1
     WHERE id IN (SELECT b.id FROM bookings b WHERE b.status = 'held' AND b.hold_expires_at <= clock_timestamp() AND ${scope}
                  FOR UPDATE SKIP LOCKED)`,
    [kitchenId, bookingIds],
  );
  await db.query(
    `UPDATE bookings SET status = 'no_show', version = version + 1
     WHERE id IN (SELECT b.id FROM bookings b
                  WHERE b.status = 'confirmed' AND ${scope}
                    AND greatest(b.start_at, b.confirmed_at) + make_interval(secs => $3) <= clock_timestamp()
                    AND NOT EXISTS (SELECT 1 FROM closed_months c WHERE c.kitchen_id = b.kitchen_id AND c.month = to_char(b.local_date, 'YYYY-MM'))
                  FOR UPDATE SKIP LOCKED)`,
    [kitchenId, bookingIds, config.noShowGraceSeconds],
  );
}

/** Saving an out-of-service window cancels the holds under it, free of charge. */
export async function cancelHoldsUnder(db: Db, stationId: string, startMs: number, endMs: number): Promise<void> {
  await db.query(
    `UPDATE bookings SET status = 'cancelled_free', hold_expires_at = NULL, version = version + 1
     WHERE station_id = $1 AND status = 'held' AND tstzrange(start_at, end_at) && tstzrange($2, $3)`,
    [stationId, new Date(startMs), new Date(endMs)],
  );
}

export function graceInstant(startMs: number, confirmedAtMs: number | null): number {
  return Math.max(startMs, confirmedAtMs ?? startMs) + config.noShowGraceSeconds * 1000;
}

/** 409 invalid_transition naming the current status, carrying `current` in the caller's shape. */
function invalidTransition(from: string, action: string, current: Record<string, unknown>, word: string): ApiError {
  return variantError(409, "invalid_transition_booking", [word], { from, action, current });
}

/** The next status for a manual action, or 409 invalid_transition with the current booking. */
export function transition(action: ManualAction, state: TransitionState, nowMs: number, current: Record<string, unknown>): Status {
  const next = nextStatus(action, state, nowMs);
  if (next === null) throw invalidTransition(state.status, action, current, STATUS_WORDS[state.status]);
  return next;
}
