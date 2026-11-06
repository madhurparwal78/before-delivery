import { connectDb, type Tx } from './db.js';
import { now } from './time.js';
import { config } from './config.js';

/** One attributed audit entry per state change, written in the same transaction (DP-88). */
export interface AuditActor {
  type: 'user' | 'token' | 'system';
  id: string | null;
}

export async function audit(
  tx: Tx,
  actor: AuditActor,
  action: string,
  entityType: 'barn_day' | 'booking' | 'visit' | 'invoice' | 'payment' | 'vet_link' | 'price_list' | 'api_token' | 'import' | 'dunning',
  entityId: string,
  from: string | null,
  to: string | null,
  requestId: string
): Promise<void> {
  await tx.query(
    `insert into audit_log(at, actor_type, actor_id, action, entity_type, entity_id, from_status, to_status, request_id)
     values($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [now(), actor.type, actor.id, action, entityType, entityId, from, to, requestId]
  );
}

export function sessionActor(userId: string): AuditActor {
  return { type: 'user', id: userId };
}

export function tokenActor(tokenId: string): AuditActor {
  return { type: 'token', id: tokenId };
}

export function systemActor(): AuditActor {
  return { type: 'system', id: null };
}
