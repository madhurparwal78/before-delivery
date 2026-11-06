// Audit trail writes: one attributed entry per audited action.
import type { Author } from "../shared/api-types.js";
import type { Db } from "./db.js";

export async function audit(db: Db, workspaceId: string, actor: Author, action: string, target: { type: string; id: string }): Promise<void> {
  await db.query(
    `INSERT INTO audit_entries (workspace_id, at, actor_kind, actor_id, actor_name, action, target_type, target_id)
     VALUES ($1, clock_timestamp(), $2, $3, $4, $5, $6, $7)`,
    [workspaceId, actor.kind, actor.id, actor.name, action, target.type, target.id]);
}
