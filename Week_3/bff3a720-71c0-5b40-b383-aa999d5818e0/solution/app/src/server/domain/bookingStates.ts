import type { BookingState } from "../../shared/api";
import { apiErrors } from "../http/errors";

const TRANSITIONS: Record<BookingState, readonly BookingState[]> = {
  held: ["confirmed", "expired"],
  requested: ["accepted", "declined", "expired", "withdrawn"],
  accepted: ["confirmed"],
  confirmed: ["cancelled_by_passenger", "cancelled_by_driver", "completed"],
  declined: [],
  expired: [],
  withdrawn: [],
  cancelled_by_passenger: [],
  cancelled_by_driver: [],
  completed: ["rated"],
  rated: [],
};

export const ALL_BOOKING_STATES = Object.keys(TRANSITIONS) as BookingState[];

/** States in which a booking takes its seats on its legs (a held booking only while its hold lasts). */
export const SEAT_HOLDING_STATES: readonly BookingState[] = ["held", "requested", "accepted", "confirmed", "completed", "rated"];

function canMove(from: BookingState, to: BookingState): boolean {
  return TRANSITIONS[from].includes(to);
}

/** Every other move answers 409 invalid_transition. */
export function assertMove(from: BookingState, to: BookingState): void {
  if (!canMove(from, to)) throw apiErrors.invalidTransition();
}
