import type { DbClient } from './db.js';
import { clientQuery } from './db.js';
import type { AuditOutcome, Role } from '../types.js';
import { nowMs } from '../clock.js';

export interface AuditSubject {
  tenantId: string | null;
  userId: string | null;
  name: string;
  role: Role | null;
  scopeSiteId: string | null;
}

export interface AuditWrite {
  subject: AuditSubject;
  action: string;
  targetType: string | null;
  targetId: string | null;
  outcome: AuditOutcome;
  addressPrefix: string | null;
}

/** The audit outcome for an answer, decided in exactly one place. */
export function outcomeForStatus(status: number): AuditOutcome {
  if (status >= 200 && status < 300) return 'allowed';
  if (status === 401) return 'refused_session';
  if (status === 403) return 'refused_csrf';
  if (status === 429) return 'refused_rate';
  if (status === 405) return 'refused_role';
  if (status === 404 || status === 410) return 'refused_scope';
  if (status === 413 || status === 415 || status === 422) return 'refused_validation';
  if (status === 409) return 'refused_conflict';
  return 'failed_dependency';
}

export async function writeAudit(client: DbClient, event: AuditWrite): Promise<void> {
  await clientQuery(
    client,
    `INSERT INTO audit_events (tenant_id, subject_user_id, scope_site_id, at, actor_user_id, actor_name, actor_role,
       action, target_type, target_id, outcome, address_prefix)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      event.subject.tenantId,
      event.subject.userId,
      event.subject.scopeSiteId,
      nowMs(),
      event.subject.userId,
      event.subject.name,
      event.subject.role,
      event.action,
      event.targetType,
      event.targetId,
      event.outcome,
      event.addressPrefix,
    ],
  );
}
