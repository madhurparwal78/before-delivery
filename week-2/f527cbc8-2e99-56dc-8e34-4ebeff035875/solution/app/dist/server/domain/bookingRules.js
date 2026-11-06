// Booking life cycle: live bookings, hold lapse at the stored instant and the cancellation verdict
// (brief: Business rules, Bookings).
import { BOOKING_EDGES, bookingActionAllowed, } from "../../shared/transitions.js";
import { illegalTransition } from "../errors.js";
/**
 * SQL predicate for a live booking at instant `nowParam`: held and not yet lapsed, confirmed, worked or no-show.
 * A hold is lapsed at and after its stored `hold_expires_at`. This is the only place the lapse rule is written.
 */
export function liveBookingSql(alias, nowParam) {
    return `(${alias}.status IN ('confirmed','worked','no_show') OR (${alias}.status = 'held' AND ${alias}.hold_expires_at > ${nowParam}))`;
}
/** Stored expiry of a hold made at `at`: plus the hold seconds, rounded up to the whole second. */
export function holdExpiry(at, holdSeconds) {
    return Math.ceil((at + holdSeconds * 1000) / 1000) * 1000;
}
/** SQL predicate for a hold that has lapsed at instant `nowParam` but is not yet written as lapsed. */
export function lapsedHoldSql(alias, nowParam) {
    return `(${alias}.status = 'held' AND NOT ${liveBookingSql(alias, nowParam)})`;
}
/** The status an action leads to; a cancellation at or after the cutoff is late. */
export function bookingTransition(current, action, lateCancellation = false) {
    if (!bookingActionAllowed(current, action))
        throw illegalTransition(current, action);
    return action === "cancel" && lateCancellation ? "cancelled_late" : BOOKING_EDGES[action].to;
}
/** A cancellation at or after the cutoff instant is late, whatever any device clock or zone says. */
export const isLateCancellation = (at, cutoff) => at >= cutoff;
export const isGoneHold = (status) => status === "released" || status === "lapsed" || status === "removed";
