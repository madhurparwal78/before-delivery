// Booking life cycle: live bookings, hold lapse at the stored instant and the cancellation verdict
// (brief: Business rules, Bookings).
import {
  BOOKING_EDGES,
  type BookingAction,
  type BookingStatus,
  type StoredBookingStatus,
  bookingActionAllowed,
} from "../../shared/transitions.js";
import { illegalTransition } from "../errors.js";

export type { StoredBookingStatus };

/**
 * SQL predicate for a live booking at instant `nowParam`: held and not yet lapsed, confirmed, worked or no-show.
 * A hold is lapsed at and after its stored `hold_expires_at`. This is the only place the lapse rule is written.
 */
export function liveBookingSql(alias: string, nowParam: string): string {
  return `(${alias}.status IN ('confirmed','worked','no_show') OR (${alias}.status = 'held' AND ${alias}.hold_expires_at > ${nowParam}))`;
}

/** Stored expiry of a hold made at `at`: plus the hold seconds, rounded up to the whole second. */
export function holdExpiry(at: number, holdSeconds: number): number {
  return Math.ceil((at + holdSeconds * 1000) / 1000) * 1000;
}

/** SQL predicate for a hold that has lapsed at instant `nowParam` but is not yet written as lapsed. */
export function lapsedHoldSql(alias: string, nowParam: string): string {
  return `(${alias}.status = 'held' AND NOT ${liveBookingSql(alias, nowParam)})`;
}

/** The status an action leads to; a cancellation at or after the cutoff is late. */
export function bookingTransition(current: StoredBookingStatus, action: BookingAction, lateCancellation = false): StoredBookingStatus {
  if (!bookingActionAllowed(current, action)) throw illegalTransition(current, action);
  return action === "cancel" && lateCancellation ? "cancelled_late" : BOOKING_EDGES[action].to;
}

/** A cancellation at or after the cutoff instant is late, whatever any device clock or zone says. */
export const isLateCancellation = (at: number, cutoff: number): boolean => at >= cutoff;

export const isGoneHold = (status: StoredBookingStatus): boolean => status === "released" || status === "lapsed" || status === "removed";
