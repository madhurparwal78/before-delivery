import type { Tx } from "./db.js";
import { uid } from "./seed.js";

/** The statuses whose station time is occupied. */
export const ACTIVE_BOOKING_STATUSES = ["confirmed", "checked_in", "overrun_billed", "checked_out", "settled"];

/** The one overlap check: half-open intervals; touching at a boundary is fine. */
export function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd;
}

export interface Blocker {
  state: "booked" | "held" | "yours_booked" | "yours_held";
  start_at: string;
  end_at: string;
  label: string;
  date: string;
}

export interface BookingRow {
  id: string;
  hold_id: string;
  site_id: string;
  station_id: string;
  renter_id: string;
  status: string;
  start_at: Date;
  end_at: Date;
  minutes: number;
  pack_minutes: number;
  card_minutes: number;
  card_cents: number;
  deposit_cents: number;
  policy_version_id: string;
  confirmed_at: Date;
  checked_in_at: Date | null;
  checked_out_at: Date | null;
  overrun_minutes: number;
  overrun_cents: number;
  cleaning_fee_charged: boolean;
  deposit_refunded: boolean;
  time_refunded: boolean;
  cutoff_run: boolean;
}

export async function audit(
  tx: Tx,
  bookingId: string,
  actor: { name: string; role: "renter" | "front_desk" | "manager" | "system" } | null,
  action: string,
  from: string,
  to: string,
  reason: string | null = null,
): Promise<void> {
  await tx.query(
    `INSERT INTO audit_events (id, booking_id, actor_name, actor_role, action, from_status, to_status, reason)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [uid("au"), bookingId, actor?.name ?? "System", actor?.role ?? "system", action, from, to, reason],
  );
}

/** The booking state machine, decided in one place. */
type Action =
  | "pay" | "cancel" | "override_cancel" | "cutoff" | "check_in" | "overrun"
  | "check_out" | "cleaning_fee" | "settle";

const TRANSITIONS: Record<Action, { from: string[]; to: string }> = {
  pay: { from: ["confirmed"], to: "confirmed" },
  cancel: { from: ["confirmed"], to: "cancelled_refunded" },
  override_cancel: { from: ["confirmed"], to: "cancelled_refunded" },
  cutoff: { from: ["confirmed"], to: "unpaid_cancelled" },
  check_in: { from: ["confirmed"], to: "checked_in" },
  overrun: { from: ["checked_in"], to: "overrun_billed" },
  check_out: { from: ["checked_in", "overrun_billed"], to: "checked_out" },
  cleaning_fee: { from: ["checked_out"], to: "checked_out" },
  settle: { from: ["checked_out"], to: "settled" },
};

export function targetFor(action: Action, status: string): string | null {
  const t = TRANSITIONS[action];
  if (!t.from.includes(status)) return null;
  return t.to;
}
