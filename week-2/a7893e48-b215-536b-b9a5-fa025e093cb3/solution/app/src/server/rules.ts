import { ApiError, invalidTransition } from "./http.js";
import { addDays, localDate, localTime, resolveLocal } from "./time.js";

export type Role = "renter" | "front_desk" | "manager";
export type HoldStatus = "held" | "expired" | "confirmed";
export type BookingStatus =
  | "confirmed" | "checked_in" | "overrun_billed" | "checked_out" | "settled"
  | "cancelled_refunded" | "cancelled_forfeit" | "unpaid_cancelled";

/** Booking statuses that occupy station time (brief: Contested time). */
export const ACTIVE_BOOKING_STATUSES: BookingStatus[] = ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled"];

type Actor = Role | "system";

interface Transition<S extends string> {
  from: S[];
  to: S | "by_refund_tier";
  who: Actor[];
}

/** The one table that decides which action is legal from which status, and who may take it. */
const HOLD_TRANSITIONS = {
  confirm: { from: ["held"], to: "confirmed", who: ["renter", "front_desk", "manager"] },
  release: { from: ["held"], to: "expired", who: ["renter", "front_desk", "manager"] },
  override_release: { from: ["held"], to: "expired", who: ["manager"] },
  expire: { from: ["held"], to: "expired", who: ["system"] },
} satisfies Record<string, Transition<HoldStatus>>;

const BOOKING_TRANSITIONS = {
  pay: { from: ["confirmed"], to: "confirmed", who: ["renter"] },
  cancel: { from: ["confirmed"], to: "by_refund_tier", who: ["renter"] },
  override_cancel: { from: ["confirmed"], to: "cancelled_refunded", who: ["manager"] },
  cutoff: { from: ["confirmed"], to: "unpaid_cancelled", who: ["system"] },
  check_in: { from: ["confirmed"], to: "checked_in", who: ["front_desk", "manager"] },
  overrun: { from: ["checked_in"], to: "overrun_billed", who: ["front_desk", "manager"] },
  check_out: { from: ["checked_in", "overrun_billed"], to: "checked_out", who: ["front_desk", "manager"] },
  cleaning_fee: { from: ["checked_out"], to: "checked_out", who: ["front_desk", "manager"] },
  settle: { from: ["checked_out"], to: "settled", who: ["front_desk", "manager"] },
} satisfies Record<string, Transition<BookingStatus>>;

export type HoldAction = keyof typeof HOLD_TRANSITIONS;
export type BookingAction = keyof typeof BOOKING_TRANSITIONS;

/** 403 when the role may never take the action. */
export function authorizeHold(action: HoldAction, role: Role): void {
  if (!(HOLD_TRANSITIONS[action].who as Actor[]).includes(role)) throw new ApiError(403, "forbidden");
}

export function authorizeBooking(action: BookingAction, role: Role): void {
  if (!(BOOKING_TRANSITIONS[action].who as Actor[]).includes(role)) throw new ApiError(403, "forbidden");
}

/** A hold is live while server time is strictly before expires_at. */
export function holdStatusAt(status: HoldStatus, expiresAt: Date, now: Date): HoldStatus {
  return status === "held" && now.getTime() >= expiresAt.getTime() ? "expired" : status;
}

/**
 * The legal next status of a hold, or the refusal: confirm on an expired hold answers hold_expired,
 * anything else outside the table answers invalid_transition. Users act on the hold's status at
 * `now` (a held hold past expires_at already reads expired); the system's expire records that
 * verdict on a stored held status once its time has come.
 */
export function holdTransition(action: HoldAction, status: HoldStatus, expiresAt: Date, now: Date): HoldStatus {
  if (action === "expire") {
    if (status === "held" && now.getTime() >= expiresAt.getTime()) return HOLD_TRANSITIONS.expire.to;
    throw invalidTransition(status, action);
  }
  const current = holdStatusAt(status, expiresAt, now);
  const rule = HOLD_TRANSITIONS[action];
  if ((rule.from as HoldStatus[]).includes(current)) return rule.to;
  if (action === "confirm" && current === "expired") throw new ApiError(410, "hold_expired");
  throw invalidTransition(current, action);
}

export interface BookingFacts {
  status: BookingStatus;
  startAt: Date;
  noticeHours: number;
  paid: boolean;
}

/** Refund tier of a cancellation at `now`: full at or before start minus the booking's own notice. */
export function refundTier(startAt: Date, noticeHours: number, now: Date): "full" | "none" {
  return now.getTime() <= startAt.getTime() - noticeHours * 3600000 ? "full" : "none";
}

/** The legal next status of a booking for an action, or invalid_transition. */
export function bookingTransition(action: BookingAction, booking: BookingFacts, now: Date): BookingStatus {
  const rule = BOOKING_TRANSITIONS[action];
  const legal = (rule.from as BookingStatus[]).includes(booking.status) && !((action === "pay" || action === "cutoff") && booking.paid);
  if (!legal) throw invalidTransition(booking.status, action);
  if (rule.to !== "by_refund_tier") return rule.to;
  return refundTier(booking.startAt, booking.noticeHours, now) === "full" ? "cancelled_refunded" : "cancelled_forfeit";
}

/** Unpaid cutoff: the start's wall time on the local date two days earlier (brief: Unpaid cutoff). */
export function unpaidCutoff(zone: string, startAt: Date): Date {
  return resolveLocal(zone, addDays(localDate(zone, startAt), -2), localTime(zone, startAt));
}

export function termsLine(noticeHours: number): string {
  return `Free cancellation until ${noticeHours} hours before start. Later cancellations keep the time charge and the deposit.`;
}

export type SegmentState = "booked" | "held" | "yours_booked" | "yours_held";

const SEGMENT_WORDS: Record<SegmentState, string> = {
  booked: "Booked", held: "Held", yours_booked: "Your booking", yours_held: "Your hold",
};

/** The time-state label of a segment or slot_taken blocker (brief: Feedback states). */
export function segmentLabel(state: SegmentState, zone: string, start: Date, end: Date): string {
  return `${SEGMENT_WORDS[state]} ${localTime(zone, start)}–${localTime(zone, end)}`;
}

export function segmentState(kind: "hold" | "booking", ownedByViewer: boolean): SegmentState {
  if (kind === "hold") return ownedByViewer ? "yours_held" : "held";
  return ownedByViewer ? "yours_booked" : "booked";
}

export type LedgerAccount = "purchased" | "available" | "reserved" | "used";
export type LedgerReason = "purchase" | "reserve" | "release" | "use" | "forfeit";

/** Which account each pack movement draws from and pays into (brief: Hour ledger). */
export const MOVEMENTS: Record<LedgerReason, { from: LedgerAccount; to: LedgerAccount }> = {
  purchase: { from: "purchased", to: "available" },
  reserve: { from: "available", to: "reserved" },
  release: { from: "reserved", to: "available" },
  use: { from: "reserved", to: "used" },
  forfeit: { from: "reserved", to: "used" },
};
