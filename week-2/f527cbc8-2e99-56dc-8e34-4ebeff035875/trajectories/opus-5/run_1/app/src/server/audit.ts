import { query, type Db } from './db.js';
import { newId } from './util.js';

/**
 * Every state change writes exactly one attributed audit entry in the same transaction.
 * The table itself refuses any edit.
 */
export type ActorType = 'user' | 'token' | 'system';

export interface Actor {
  type: ActorType;
  id: string | null;
}

export const systemActor: Actor = { type: 'system', id: null };

export type AuditEntityType =
  | 'barn_day'
  | 'booking'
  | 'visit'
  | 'invoice'
  | 'payment'
  | 'vet_link'
  | 'price_list'
  | 'api_token'
  | 'import'
  | 'dunning';

export interface AuditWrite {
  actor: Actor;
  action: string;
  entityType: AuditEntityType;
  entityId: string;
  from?: string | null;
  to?: string | null;
  at: Date;
  requestId: string | null;
}

export async function writeAudit(db: Db, entry: AuditWrite): Promise<void> {
  await query(
    db,
    `INSERT INTO audit_log (id, at, actor_type, actor_id, action, entity_type, entity_id,
                            from_state, to_state, request_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      newId(),
      entry.at,
      entry.actor.type,
      entry.actor.id,
      entry.action,
      entry.entityType,
      entry.entityId,
      entry.from ?? null,
      entry.to ?? null,
      entry.requestId,
    ],
  );
}
