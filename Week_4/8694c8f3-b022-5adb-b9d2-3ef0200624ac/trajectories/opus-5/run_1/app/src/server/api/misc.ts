import { pool } from '../db.js';
import type { Ctx, Reply } from '../http.js';
import { requireMembership } from '../access.js';
import { readActivity } from '../domain/activitylog.js';
import { storageHealthy } from '../storage.js';
import { collabHealthy } from '../collab.js';

export async function listActivity(ctx: Ctx): Promise<Reply> {
  const membership = await requireMembership(ctx, ctx.params['id'] ?? '');
  const beforeText = ctx.query.get('before');
  const before = beforeText !== null && /^\d+$/.test(beforeText) ? beforeText : null;
  const entries = await readActivity(pool, membership.setId, before);
  return { status: 200, json: { entries } };
}

export async function getStatus(): Promise<Reply> {
  return {
    status: 200,
    json: {
      storage: storageHealthy() ? 'ok' : 'unreachable',
      collab: collabHealthy() ? 'ok' : 'unreachable',
      checked_at: new Date().toISOString(),
    },
  };
}

export async function getHealth(): Promise<Reply> {
  await pool.query('select 1');
  return { status: 200, json: { status: 'ok' } };
}
