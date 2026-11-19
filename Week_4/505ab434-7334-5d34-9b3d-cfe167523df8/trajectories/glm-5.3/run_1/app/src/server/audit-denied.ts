import { withTransaction, type Tx } from './db';
import { appendAudit, type AuditAction } from './audit';
import { notify } from './pglisten';

export interface DeniedAudit {
  actorId: string;
  actorRole: string;
  action: AuditAction;
  resourceType: string;
  resourceId: string;
  requestId?: string | null;
}

/** Records a 403 refusal as an audit record with outcome denied. */
export async function auditDenied(record: DeniedAudit, now: Date): Promise<void> {
  await withTransaction(async (tx) => {
    await appendAudit(tx, {
      occurredAt: now,
      actorId: record.actorId,
      actorRole: record.actorRole,
      action: record.action,
      resourceType: record.resourceType,
      resourceId: record.resourceId,
      requestId: record.requestId ?? null,
      before: null,
      after: null,
      outcome: 'denied',
    });
    await notify(tx, JSON.stringify({ type: 'library.updated' }));
  });
}

export type { Tx };
