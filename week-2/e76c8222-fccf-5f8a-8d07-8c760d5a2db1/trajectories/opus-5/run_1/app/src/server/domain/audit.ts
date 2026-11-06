import { Db } from '../db/pool';

export type AuditAction =
  | 'request.created'
  | 'request.updated'
  | 'request.submitted'
  | 'request.cancelled'
  | 'request.status_changed'
  | 'offer.withdrawn'
  | 'offer.accepted'
  | 'offer.declined'
  | 'offer.expired'
  | 'seat.offered'
  | 'timesheet.submitted'
  | 'timesheet.approved'
  | 'rates.updated'
  | 'credential.added'
  | 'preferences.updated';

export type AuditEntity =
  | 'request'
  | 'seat'
  | 'offer'
  | 'timesheet'
  | 'rates'
  | 'credential'
  | 'preferences';

export interface AuditInput {
  actorId: string | null;
  action: AuditAction;
  entity: AuditEntity;
  entityId: string;
  requestId: string | null;
  from?: string | null;
  to?: string | null;
  detail?: Record<string, unknown>;
}

export async function writeAudit(db: Db, entry: AuditInput): Promise<void> {
  await db.query(
    `insert into audit_entries
       (actor_id, action, entity, entity_id, request_id, from_status, to_status, detail)
     values ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`,
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
