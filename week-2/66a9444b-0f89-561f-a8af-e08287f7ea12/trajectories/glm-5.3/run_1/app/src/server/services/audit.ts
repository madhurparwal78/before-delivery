import type { PoolClient } from "pg";

export interface AuditActor {
  email: string;
  role: string;
}

export async function writeAudit(
  client: PoolClient,
  actor: string,
  actorRole: string,
  action: string,
  targetType: string,
  targetId: string,
  detail: string | null = null,
): Promise<void> {
  await client.query(
    "insert into audit (actor, actor_role, action, target_type, target_id, detail) values ($1,$2,$3,$4,$5,$6)",
    [actor, actorRole, action, targetType, targetId, detail],
  );
}
