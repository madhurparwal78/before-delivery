import type { Ctx, Method } from './http';
import { requireSession } from './http';
import { query } from './db';
import { methodNotAllowed, notFound } from './errors';
import { canonicalForm, recordHashFor } from './audit';
import { formatDateTime } from './datetime';
import type { Config } from './config';

const AUDIT_ACTIONS = [
  'request.submitted',
  'request.assigned',
  'request.decided',
  'request.withdrawn',
  'request.escalated',
  'request.expired',
  'condition.added',
  'grant.minted',
  'grant.activated',
  'grant.revoked',
  'proof.uploaded',
  'proof.accepted',
  'proof.rejected',
  'asset.released',
  'asset.restricted',
  'asset.retired',
  'chapter.submitted',
  'chapter.approved',
  'chapter.changes_requested',
  'chapter.published',
  'link.issued',
];

export function routeAudit(
  router: { add: (m: Method, p: string, h: (ctx: Ctx) => Promise<unknown>) => void },
  cfg: Config,
): void {
  router.add('GET', '/audit', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner' && principal.role !== 'legal_reviewer') throw notFound();
    const requestId = ctx.url.searchParams.get('requestId');
    const action = ctx.url.searchParams.get('action');
    const from = ctx.url.searchParams.get('from');
    const to = ctx.url.searchParams.get('to');
    const params: unknown[] = [];
    const clauses: string[] = [];
    if (requestId) {
      params.push(requestId);
      clauses.push(`request_id = $${params.length}`);
    }
    if (action && action !== 'All actions') {
      params.push(action);
      clauses.push(`action = $${params.length}`);
    }
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) {
      params.push(`${from} 00:00:00+00`);
      clauses.push(`occurred_at >= $${params.length}::timestamptz`);
    }
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) {
      params.push(`${to} 23:59:59.999+00`);
      clauses.push(`occurred_at <= $${params.length}::timestamptz`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
    const rows = await query<{
      sequence: string;
      occurred_at: Date;
      actor_id: string;
      actor_role: string;
      action: string;
      resource_type: string;
      resource_id: string;
      request_id: string | null;
      before: unknown;
      after: unknown;
      outcome: string;
      previous_hash: string;
      record_hash: string;
    }>(`SELECT * FROM audit_records ${where} ORDER BY sequence`, params);
    const actorIds = [...new Set(rows.map((r) => r.actor_id))];
    const actors = actorIds.length > 0
      ? await query<{ id: string; display_name: string }>('SELECT id, display_name FROM principals WHERE id = ANY($1::text[])', [actorIds])
      : [];
    const nameOf = new Map(actors.map((a) => [a.id, a.display_name]));
    return {
      records: rows.map((row) => ({
        sequence: Number(row.sequence),
        time: formatDateTime(row.occurred_at, cfg.appTimeZone),
        occurredAt: row.occurred_at.toISOString(),
        actorId: row.actor_id,
        actor: row.actor_id === 'system' ? 'System' : nameOf.get(row.actor_id) ?? row.actor_id,
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
      })),
      actions: AUDIT_ACTIONS,
    };
  });

  router.add('GET', '/audit/verify', async (ctx) => {
    const principal = requireSession(ctx);
    if (principal.role !== 'owner' && principal.role !== 'legal_reviewer') throw notFound();
    const rows = await query<{
      sequence: number;
      occurred_at: Date;
      actor_id: string;
      actor_role: string;
      action: string;
      resource_type: string;
      resource_id: string;
      request_id: string | null;
      before: unknown;
      after: unknown;
      outcome: string;
      previous_hash: string;
      record_hash: string;
    }>('SELECT * FROM audit_records ORDER BY sequence');
    let previous = '0'.repeat(64);
    let brokenAt: number | null = null;
    for (const row of rows) {
      if (row.previous_hash !== previous) {
        brokenAt = Number(row.sequence);
        break;
      }
      const canonical = canonicalForm({
        sequence: Number(row.sequence),
        occurredAt: row.occurred_at,
        actorId: row.actor_id,
        actorRole: row.actor_role,
        action: row.action,
        resourceType: row.resource_type,
        resourceId: row.resource_id,
        requestId: row.request_id,
        before: row.before,
        after: row.after,
        outcome: row.outcome,
      });
      const recomputed = recordHashFor(previous, canonical);
      if (recomputed !== row.record_hash) {
        brokenAt = Number(row.sequence);
        break;
      }
      previous = row.record_hash;
    }
    return { ok: brokenAt === null, records: rows.length, brokenAt };
  });
}

/** Answers 405 for every write attempt on /api/audit and below. */
export function auditWriteGuard(method: string, path: string): boolean {
  return path === '/api/audit' || path.startsWith('/api/audit/');
}
