import type { Client } from '../db/pool.js';

export type AuditAction =
  | 'status_changed' | 'price_changed' | 'compare_at_changed' | 'stock_adjusted'
  | 'image_added' | 'shipment_created' | 'cancelled' | 'created';

export type AuditEntity = 'product' | 'variant' | 'order' | 'return' | 'trial' | 'warranty_claim' | 'discount_code';

/** Every staff write appends one audit entry in the same step as the write. */
export async function audit(
  client: Client,
  actor: { id: number; name: string; role: string },
  action: AuditAction,
  entity: AuditEntity,
  entityId: string,
  before: Record<string, unknown> | null,
  after: Record<string, unknown> | null,
): Promise<void> {
  await client.query(
    `INSERT INTO audit_entries (actor_id, actor_name, actor_role, action, entity, entity_id, before, after)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [actor.id, actor.name, actor.role, action, entity, entityId, before === null ? null : JSON.stringify(before), after === null ? null : JSON.stringify(after)],
  );
}
