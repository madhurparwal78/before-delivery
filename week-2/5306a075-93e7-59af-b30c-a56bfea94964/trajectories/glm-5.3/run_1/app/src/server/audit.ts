import type { Pool, PoolClient } from "pg";

/** An audit trail entry is written with every state change. */
export async function audit(
  client: Pool | PoolClient,
  workspaceId: string,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string,
  detail: Record<string, unknown> | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (workspace_id, actor_id, action, entity_type, entity_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [workspaceId, actorId, action, entityType, entityId, detail === null ? null : JSON.stringify(detail)],
  );
}
