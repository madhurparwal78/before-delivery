import type { Role } from '../../shared/types.js';
import type { Db } from '../db/pool.js';

export interface AuditInput {
  bookingId?: string | null;
  holdId?: string | null;
  actorName: string;
  actorRole: Role | 'system';
  action: string;
  from: string;
  to: string;
  reason?: string | null;
}

export async function writeAudit(db: Db, event: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (booking_id, hold_id, actor_name, actor_role, action, from_status, to_status, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.bookingId ?? null,
      event.holdId ?? null,
      event.actorName,
      event.actorRole,
      event.action,
      event.from,
      event.to,
      event.reason ?? null,
    ],
  );
}
