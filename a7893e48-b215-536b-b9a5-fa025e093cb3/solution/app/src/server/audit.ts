import type { Actor } from "./auth.js";
import type { Db } from "./db.js";

export interface AuditEvent {
  bookingId?: string | null;
  holdId?: string | null;
  actor: Actor | "system";
  action: string;
  from: string | null;
  to: string | null;
  at: Date;
  reason?: string | null;
}

/** One attributed audit event per status change, payment, fee and refund. */
export async function audit(db: Db, event: AuditEvent): Promise<void> {
  const [name, role] = event.actor === "system" ? ["System", "system"] : [event.actor.name, event.actor.role];
  await db.query(
    `INSERT INTO audit_events (booking_id, hold_id, at, actor_name, actor_role, action, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [event.bookingId ?? null, event.holdId ?? null, event.at, name, role, event.action, event.from, event.to, event.reason ?? null]);
}
