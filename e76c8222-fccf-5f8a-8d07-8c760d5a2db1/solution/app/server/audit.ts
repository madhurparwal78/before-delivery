// Audit entries: one per changed entity, written inside the transaction that makes the change.
import type { PoolClient } from "pg";

interface AuditEntry {
  actorId: string | null;
  action: string;
  entity: "request" | "seat" | "offer" | "timesheet" | "rates" | "credential" | "preferences";
  entityId: string;
  requestId: string | null;
  from?: string | null;
  to?: string | null;
  detail?: Record<string, unknown>;
}

export async function audit(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, entity, entity_id, request_id, from_status, to_status, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorId,
      entry.action,
      entry.entity,
      entry.entityId,
      entry.requestId,
      entry.from ?? null,
      entry.to ?? null,
      JSON.stringify(entry.detail ?? {}),
    ],
  );
}
