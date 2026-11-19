// The booking state machine: the only place a status change is judged legal.
import { ApiError } from "./http.ts";
import type { BookingStatus, Role } from "../shared/api.ts";

type BookingAction = "confirm" | "release" | "expire" | "cancel" | "check_in" | "no_show" | "check_out";

const TRANSITIONS: Record<BookingAction, { from: BookingStatus; to: BookingStatus }> = {
  confirm: { from: "held", to: "confirmed" },
  release: { from: "held", to: "cancelled" },
  expire: { from: "held", to: "expired" },
  cancel: { from: "confirmed", to: "cancelled" },
  check_in: { from: "confirmed", to: "checked_in" },
  no_show: { from: "confirmed", to: "no_show" },
  check_out: { from: "checked_in", to: "checked_out" },
};

/** The status `action` leads to from `status`, or the 409 the state machine gives. */
export function transition(action: BookingAction, status: BookingStatus): BookingStatus {
  const rule = TRANSITIONS[action];
  if (status === rule.from) return rule.to;
  if (action === "confirm" && status === "expired") throw new ApiError("hold_expired");
  throw new ApiError("invalid_transition");
}

/**
 * Who may cancel: the owning member releases a hold or cancels a confirmed booking; a kitchen
 * manager of the booking's site cancels only confirmed bookings, and must give a reason.
 */
export function cancelAction(role: Role, status: BookingStatus): "release" | "cancel" {
  const action = role === "member" && status === "held" ? "release" : "cancel";
  transition(action, status);
  return action;
}

export function cancelFields(role: Role): string[] {
  return role === "kitchen_manager" ? ["reason"] : [];
}
