import { newId } from '../lib/codes.js';
import type { Queryable } from '../db/pool.js';

export interface AuditInput {
  actor: string;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  detail?: Record<string, unknown>;
}

export async function writeAudit(db: Queryable, input: AuditInput): Promise<void> {
  await db.query(
    `INSERT INTO audit_entries (id, actor, actor_role, action, target_type, target_id, detail)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      newId(),
      input.actor,
      input.actorRole,
      input.action,
      input.targetType,
      input.targetId,
      JSON.stringify(input.detail ?? {}),
    ],
  );
}
