import { Db } from '../db/pool';
import { SessionUser } from '../http/context';

export type AuditEntity = 'product' | 'variant' | 'order' | 'return' | 'trial' | 'warranty_claim' | 'discount_code';

export async function appendAudit(
  client: Db,
  actor: SessionUser,
  action: string,
  entity: AuditEntity,
  entityId: string,
  before: unknown,
  after: unknown
): Promise<void> {
  await client.query(
    `INSERT INTO audit_entries (actor_id, actor_name, actor_role, action, entity, entity_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)`,
    [
      actor.id,
      actor.name,
      actor.role,
      action,
      entity,
      entityId,
      before === null ? null : JSON.stringify(before),
      after === null ? null : JSON.stringify(after)
    ]
  );
}
