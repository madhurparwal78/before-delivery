import type { BookingState, DocumentRow, DocumentState, HoldRow, HoldState } from "./domain.js";
import { refuse } from "./errors.js";
import { dayDiff } from "./kitchenTime.js";

// The brief's state rules, each decided in exactly one place.

/** A hold is live while the server clock is strictly before expires_at. */
export function holdState(hold: Pick<HoldRow, "state" | "expires_at">, now: Date): HoldState {
  if (hold.state === "held" && now.getTime() >= hold.expires_at.getTime()) return "expired";
  return hold.state;
}

/** Refuses any request on a hold that is no longer live. */
export function requireLiveHold(hold: Pick<HoldRow, "state" | "expires_at">, now: Date): void {
  const state = holdState(hold, now);
  if (state === "expired") throw refuse.holdExpired();
  if (state !== "held") throw refuse.holdNotActive(state);
}

/** In window when the server clock is at or before starts_at minus the stored window. */
export function cancelInWindow(startsAt: Date, windowHours: number, now: Date): boolean {
  return now.getTime() <= startsAt.getTime() - windowHours * 3_600_000;
}

export type DayAction = "check_in" | "complete" | "no_show";

const TARGETS: Record<DayAction, BookingState> = {
  check_in: "checked_in",
  complete: "completed",
  no_show: "no_show",
};

/** Only a confirmed booking can be cancelled; its target state is decided by cancelInWindow. */
export function requireCancellable(state: BookingState): void {
  if (state !== "confirmed") throw refuse.invalidTransition(state, "cancelled");
}

/**
 * The operator's day-sheet transitions: confirmed -> checked_in or no_show from the booking day,
 * checked_in -> completed. Anything else is invalid_transition.
 */
export function dayTransition(state: BookingState, action: DayAction, bookingDate: string, today: string): BookingState {
  const target = TARGETS[action];
  const legal = action === "complete" ? state === "checked_in" : state === "confirmed";
  if (!legal) throw refuse.invalidTransition(state, target);
  if (action !== "complete" && today < bookingDate) throw refuse.bookingDayNotReached();
  return target;
}

/** A document's state as read on a kitchen date. */
export function documentState(doc: Pick<DocumentRow, "state" | "type" | "expires_on">, today: string): DocumentState {
  if (doc.state === "rejected" || doc.type === "kitchen_agreement" || doc.expires_on === null) return doc.state;
  if (today > doc.expires_on) return "expired";
  if (doc.state === "verified" && dayDiff(today, doc.expires_on) <= 14) return "expiring";
  return doc.state;
}

/** Documents move uploaded -> verified or uploaded -> rejected, by the operator. */
export function documentReview(current: DocumentState, to: "verified" | "rejected"): void {
  if (current !== "uploaded") throw refuse.invalidTransition(current, to);
}

/**
 * Compliance cover: the earlier of the latest verified-or-expiring insurance expiry and the latest
 * verified-or-expiring food-handler expiry; null when either is missing.
 */
export function coveredUntil(docs: Pick<DocumentRow, "state" | "type" | "expires_on">[], today: string): string | null {
  const latest = (type: "insurance" | "food_handler"): string | null => {
    let found: string | null = null;
    for (const doc of docs) {
      const counts = doc.type === type && ["verified", "expiring"].includes(documentState(doc, today));
      if (counts && doc.expires_on !== null && (found === null || doc.expires_on > found)) found = doc.expires_on;
    }
    return found;
  };
  const insurance = latest("insurance");
  const card = latest("food_handler");
  if (insurance === null || card === null) return null;
  return insurance < card ? insurance : card;
}

export function covers(cover: string | null, date: string): boolean {
  return cover !== null && date <= cover;
}
