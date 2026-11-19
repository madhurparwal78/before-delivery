import type { AuditRecord } from '../../shared/types.js';
import { verifyChain } from '../audit.js';
import { db } from '../db.js';
import { errors } from '../errors.js';
import { requireSignedIn, type Ctx } from '../http/context.js';
import { sendJson } from '../http/respond.js';
import { repo } from '../repo.js';

function requireAuditReader(ctx: Ctx): void {
  const principal = requireSignedIn(ctx);
  if (principal.role !== 'owner' && principal.role !== 'legal_reviewer') throw errors.notFound();
}

export async function listAudit(ctx: Ctx): Promise<void> {
  requireAuditReader(ctx);

  const requestId = ctx.url.searchParams.get('requestId');
  const action = ctx.url.searchParams.get('action');
  const from = ctx.url.searchParams.get('from');
  const to = ctx.url.searchParams.get('to');

  const conditions: string[] = [];
  const params: (string | Date)[] = [];
  if (requestId) {
    params.push(requestId);
    conditions.push(`request_id = $${params.length}`);
  }
  if (action) {
    params.push(action);
    conditions.push(`action = $${params.length}`);
  }
  if (from) {
    params.push(new Date(`${from}T00:00:00.000Z`));
    conditions.push(`occurred_at >= $${params.length}`);
  }
  if (to) {
    params.push(new Date(`${to}T23:59:59.999Z`));
    conditions.push(`occurred_at <= $${params.length}`);
  }

  const where = conditions.length > 0 ? `where ${conditions.join(' and ')}` : '';
  const result = await db.query<{
    sequence: number;
    occurred_at: Date;
    actor_id: string;
    actor_role: string;
    action: string;
    resource_type: string;
    resource_id: string;
    request_id: string | null;
    before: Record<string, unknown> | null;
    after: Record<string, unknown> | null;
    outcome: 'success' | 'denied';
    previous_hash: string;
    record_hash: string;
  }>(`select * from audit_log ${where} order by sequence asc`, params);

  const principals = await repo.principals();
  const names = new Map(principals.map((principal) => [principal.id, principal.displayName]));

  const records: AuditRecord[] = result.rows.map((row) => ({
    sequence: row.sequence,
    occurredAt: row.occurred_at.toISOString(),
    actorId: row.actor_id,
    actorName: row.actor_id === 'system' ? 'System' : (names.get(row.actor_id) ?? row.actor_id),
    actorRole: row.actor_role,
    action: row.action,
    resourceType: row.resource_type,
    resourceId: row.resource_id,
    requestId: row.request_id,
    before: row.before,
    after: row.after,
    outcome: row.outcome,
    previousHash: row.previous_hash,
    recordHash: row.record_hash,
  }));

  sendJson(ctx.res, 200, { records });
}

export async function verifyAudit(ctx: Ctx): Promise<void> {
  requireAuditReader(ctx);
  sendJson(ctx.res, 200, await verifyChain());
}

export async function auditWriteBlocked(ctx: Ctx): Promise<void> {
  requireAuditReader(ctx);
  throw errors.methodNotAllowed();
}
