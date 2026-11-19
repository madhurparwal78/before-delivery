// Booking states and the transitions between them: each is decided here, once.
import type { BookingStatus } from "../../shared/api.js";
import { apiErrors } from "../errors.js";
import { lisbonDate, lisbonTime } from "../lisbon.js";
import { noShowAllowedFrom, refundsIfCancelledAt } from "./deposit.js";

export type HostAction = "seat" | "clear" | "no_show";

interface BookingFacts {
  status: BookingStatus;
  date: string;
  starts_at: Date;
}

/** booked -> seated (only on the booking's Lisbon date); seated -> completed; booked -> no_show (only from 15 minutes after the slot starts). */
export function hostTransition(booking: BookingFacts, action: HostAction, at: Date): BookingStatus {
  if (action === "seat") {
    if (booking.status !== "booked") throw apiErrors.invalidTransition();
    if (booking.date !== lisbonDate(at)) throw apiErrors.notTonight();
    return "seated";
  }
  if (action === "clear") {
    if (booking.status !== "seated") throw apiErrors.invalidTransition();
    return "completed";
  }
  if (booking.status !== "booked") throw apiErrors.invalidTransition();
  const earliest = noShowAllowedFrom(booking.starts_at);
  if (at < earliest) throw apiErrors.tooEarly(lisbonTime(earliest));
  return "no_show";
}

/** booked -> cancelled_refunded at least 24 hours before the slot, otherwise cancelled_retained. */
export function guestCancellation(booking: BookingFacts, at: Date): "cancelled_refunded" | "cancelled_retained" {
  if (booking.status === "seated") throw apiErrors.invalidTransition();
  if (booking.status !== "booked") throw apiErrors.linkExpired();
  if (at >= booking.starts_at) throw apiErrors.slotStarted();
  return refundsIfCancelledAt(booking.starts_at, at) ? "cancelled_refunded" : "cancelled_retained";
}

/** A manage link works while the booking is booked or seated. */
export function linkIsAlive(status: BookingStatus): boolean {
  return status === "booked" || status === "seated";
}

export function occupiesTable(status: BookingStatus): boolean {
  return status === "booked" || status === "seated";
}
