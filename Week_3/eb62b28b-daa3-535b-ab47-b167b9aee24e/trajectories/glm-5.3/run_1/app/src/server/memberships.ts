import type { Database } from "./db.js";
import type { MembershipView } from "../shared/views.js";
import type { Cadence, TimeZoneKey } from "../shared/enums.js";
import { ApiError } from "./errors.js";
import { copy } from "../shared/copy.js";

export type MembershipRow = {
  member_id: string;
  state: string;
  cadence: string | null;
  renewal_date: string | null;
  plus_until: string | null;
  pending_cadence: string | null;
  pending_from: string | null;
  kb_subscription_id: string | null;
  kb_plan_name: string | null;
  kb_charged_through: string | null;
  join_requested_at: Date | null;
  last_kb_check_at: Date | null;
};

export function membershipView(row: MembershipRow): MembershipView {
  return {
    state: row.state as MembershipView["state"],
    cadence: (row.cadence as Cadence | null) ?? null,
    renewalDate: row.renewal_date,
    plusUntil: row.plus_until,
    pendingCadence: (row.pending_cadence as Cadence | null) ?? null,
    pendingFrom: row.pending_from,
  };
}

export async function membershipFor(db: Database, memberId: string): Promise<MembershipRow | null> {
  return db.one<MembershipRow>(
    `SELECT member_id, state, cadence, renewal_date::text AS renewal_date, plus_until::text AS plus_until,
      pending_cadence, pending_from::text AS pending_from, kb_subscription_id, kb_plan_name,
      kb_charged_through::text AS kb_charged_through, join_requested_at, last_kb_check_at
     FROM memberships WHERE member_id = $1`,
    [memberId]
  );
}

/** Plus in force on a date: active, or cancelled with plusUntil on or after it. */
export function plusInForceOn(membership: MembershipRow, phoenixDate: string): boolean {
  if (membership.state === "active") return true;
  if (membership.state === "cancelled" && membership.plus_until) {
    return membership.plus_until >= phoenixDate;
  }
  return false;
}

/** Plus in force today; pending is not yet in force. */
export function plusInForceToday(membership: MembershipRow): boolean {
  const today = new Date().toISOString().slice(0, 10);
  return plusInForceOn(membership, today);
}

export function requireNotClosing(accountState: string): void {
  if (accountState === "closing" || accountState === "erasing") {
    throw new ApiError(409, "account_closing", copy("account_closing_write"));
  }
}

export function requireActive(accountState: string): void {
  if (accountState !== "active") {
    throw new ApiError(409, "account_closing", copy("account_closing_write"));
  }
}

export type MemberCore = {
  id: string;
  name: string;
  email: string;
  sex: string | null;
  date_of_birth: string | null;
  time_zone: string;
  state: string;
  account_state: string;
  address_line1: string | null;
  city: string | null;
  postal_code: string | null;
  gate_notes: string | null;
};

export async function memberCore(db: Database, memberId: string): Promise<MemberCore | null> {
  return db.one<MemberCore>(
    `SELECT id, name, email, sex, date_of_birth::text AS date_of_birth, time_zone, state, account_state,
      address_line1, city, postal_code, gate_notes
     FROM members WHERE id = $1`,
    [memberId]
  );
}

export function memberTimeZone(core: { time_zone: string }): TimeZoneKey {
  return core.time_zone as TimeZoneKey;
}
