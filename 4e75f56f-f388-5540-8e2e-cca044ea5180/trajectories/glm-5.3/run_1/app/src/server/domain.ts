export type Role = "practitioner" | "clinic" | "registrar" | "director" | "frontdesk";

export type Tier = "bench" | "atelier";

export type ReservationState =
  | "held"
  | "deposit_paid"
  | "paid_in_full"
  | "checked_in_day1"
  | "checked_in_day2"
  | "certificate_issued"
  | "released"
  | "cancelled"
  | "refunded";

export type PaymentPending = "deposit" | "balance" | "full" | "upgrade" | "group" | null;

export type LicenceStatus = "none" | "submitted" | "matched" | "rejected";

export type WaitlistState = "waitlisted" | "offered" | "offer_lapsed";

const ACTIVE_STATES: ReadonlySet<ReservationState> = new Set([
  "held",
  "deposit_paid",
  "paid_in_full",
  "checked_in_day1",
  "checked_in_day2",
  "certificate_issued",
]);

export function isActive(state: ReservationState): boolean {
  return ACTIVE_STATES.has(state);
}

export function tierOfRow(row: string): Tier {
  return row === "A" || row === "B" ? "atelier" : "bench";
}

export function isAtelierRow(row: string): boolean {
  return row === "A" || row === "B";
}

export const TRANSITIONS: Record<string, ReservationState[]> = {
  held: ["deposit_paid", "paid_in_full", "released"],
  deposit_paid: ["paid_in_full", "cancelled"],
  paid_in_full: ["checked_in_day1", "cancelled"],
  checked_in_day1: ["checked_in_day2"],
  checked_in_day2: ["certificate_issued"],
  certificate_issued: [],
  released: [],
  cancelled: ["refunded"],
  refunded: [],
};

export function canMove(from: ReservationState, to: ReservationState): boolean {
  return (TRANSITIONS[from] ?? []).includes(to);
}
