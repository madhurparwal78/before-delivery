// Membership: pending-payment → active → lapsed.
import type { Db } from "../db.js";
import { one } from "../db.js";

export interface MembershipRow {
  tier: string;
  status: "pending-payment" | "active";
  ends_at_term: boolean;
  active_until: string | null;
}

/** Stored status, except that an ending membership lapses on the first library-local day after `active_until`. */
export function membershipStatus(row: MembershipRow, today: string): "pending-payment" | "active" | "lapsed" {
  if (row.status === "active" && row.ends_at_term && row.active_until !== null && today > row.active_until) return "lapsed";
  return row.status;
}

export async function membershipOf(db: Db, userId: number): Promise<MembershipRow | undefined> {
  return one<MembershipRow>(db, `SELECT tier, status, ends_at_term, active_until FROM memberships WHERE user_id = $1`, [userId]);
}
