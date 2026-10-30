// The hour ledger: every movement is two opposite entries with one movement ID (brief: Hour ledger).
import { randomUUID } from "node:crypto";
import type { LedgerReason } from "../shared/kitchen";
import type { Queryable } from "./db";

/** Writes one movement: `minutes` on the tenant's pack and the opposite on the kitchen's hours. */
export async function recordMovement(db: Queryable, tenantId: string, minutes: number, reason: LedgerReason, bookingId: string | null, at: Date): Promise<void> {
  const movementId = randomUUID();
  await db.query(
    `INSERT INTO ledger_entries (id, movement_id, tenant_id, account, minutes, reason, booking_id, created_at)
     VALUES ($1, $3, $4, 'tenant_pack', $5, $6, $7, $8), ($2, $3, $4, 'kitchen_hours', $9, $6, $7, $8)`,
    [randomUUID(), randomUUID(), movementId, tenantId, minutes, reason, bookingId, at, -minutes],
  );
}
