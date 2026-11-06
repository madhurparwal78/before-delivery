import { randomUUID } from 'node:crypto';
import type { Queryable } from '../pool.js';

export async function recordStateChange(
  db: Queryable,
  event: {
    actorUserId: string | null;
    entity: string;
    entityId: string;
    fromState: string | null;
    toState: string;
    detail?: Record<string, unknown>;
  },
): Promise<void> {
  await db.query(
    `INSERT INTO audit_events (id, actor_user_id, entity, entity_id, from_state, to_state, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      randomUUID(),
      event.actorUserId,
      event.entity,
      event.entityId,
      event.fromState,
      event.toState,
      JSON.stringify(event.detail ?? {}),
    ],
  );
}
