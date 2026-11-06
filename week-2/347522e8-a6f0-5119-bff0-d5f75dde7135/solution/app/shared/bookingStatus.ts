// The booking state machine and hold liveness, decided here only. The server applies every
// transition through it; the board reads `occupiesStation` to tell when an own ticket has left.

import type { BookingStatus } from "./api.js";

/** Legal transitions (Business rules, Booking states). */
const TRANSITIONS: Readonly<Record<BookingStatus, readonly BookingStatus[]>> = {
  hold: ["confirmed", "expired", "displaced"],
  confirmed: ["displaced", "cancelled", "checked_in"],
  checked_in: ["completed"],
  completed: [],
  expired: [],
  cancelled: [],
  displaced: [],
};

export function canTransition(from: BookingStatus, to: BookingStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

/** A hold is live while the clock is strictly before its expiry instant. */
export function isHoldLive(holdExpiresAt: number, at: number): boolean {
  return at < holdExpiresAt;
}

/** The status every read reports: a hold whose instant has passed is expired, recorded or not. */
export function statusAt(stored: BookingStatus, holdExpiresAt: number, at: number): BookingStatus {
  return stored === "hold" && !isHoldLive(holdExpiresAt, at) ? "expired" : stored;
}

/** A hold or a confirmed, checked-in or completed booking occupies its station. */
export function occupiesStation(status: BookingStatus): boolean {
  return status === "hold" || status === "confirmed" || status === "checked_in" || status === "completed";
}
