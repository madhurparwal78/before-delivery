import { ApiError, sendJson } from '../http/respond.js';
import { pool, withTransaction } from '../db/pool.js';
import { now, toInstant, todayPhoenix, isValidDate, addDays } from '../domain/time.js';
import { newId } from '../domain/id.js';
import { recordLedger } from './ledger.js';
import { broadcast } from './events.js';
import type { RouteContext } from './routes.js';

export async function listPolicies(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.kind === 'partner') throw new ApiError('forbidden');
  const today = todayPhoenix(now());
  const res = await pool.query(
    `SELECT id, kind, days, effective_from::text AS effective_from FROM policies ORDER BY kind, effective_from`,
  );
  const byKind = new Map<string, { id: string; effectiveFrom: string }>();
  for (const row of res.rows) {
    const kind = row['kind'] as string;
    if (row['effective_from'] <= today) {
      const current = byKind.get(kind);
      if (!current || row['effective_from'] > current.effectiveFrom) {
        byKind.set(kind, { id: row['id'], effectiveFrom: row['effective_from'] });
      }
    }
  }
  const policies = res.rows.map(r => {
    const kind = r['kind'] as string;
    const inForceId = byKind.get(kind)?.id;
    const effectiveFrom = r['effective_from'] as string;
    const state = r['id'] === inForceId ? 'in_force' : effectiveFrom > today ? 'scheduled' : 'past';
    return { id: r['id'], kind, days: Number(r['days']), effectiveFrom, state };
  });
  sendJson(ctx.res, 200, { today, policies });
}

export async function schedulePolicy(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.staffRole !== 'admin') throw new ApiError('forbidden');
  const body = ctx.body ?? {};
  const kind = body['kind'];
  const days = body['days'];
  const effectiveFrom = body['effectiveFrom'];
  if (kind !== 'bin_retention_days' && kind !== 'partner_grant_days') throw new ApiError('validation', { kind: 'Choose a policy kind.' });
  if (typeof days !== 'number' || !Number.isInteger(days)) {
    throw new ApiError('validation', { days: kind === 'bin_retention_days' ? 'Enter whole days from 1 to 90.' : 'Enter whole days from 1 to 365.' });
  }
  const max = kind === 'bin_retention_days' ? 90 : 365;
  if (days < 1 || days > max) {
    throw new ApiError('validation', { days: kind === 'bin_retention_days' ? 'Enter whole days from 1 to 90.' : 'Enter whole days from 1 to 365.' });
  }
  const today = todayPhoenix(now());
  if (typeof effectiveFrom !== 'string' || !isValidDate(effectiveFrom) || effectiveFrom <= today) {
    throw new ApiError('validation', { effectiveFrom: 'Choose a date after today.' });
  }
  const policyId = newId('pol');
  await withTransaction(async (client) => {
    const exists = await client.query('SELECT id FROM policies WHERE kind = $1 AND effective_from = $2', [kind, effectiveFrom]);
    if (exists.rows.length > 0) throw new ApiError('policy_exists');
    await client.query(
      'INSERT INTO policies (id, kind, days, effective_from, created_at) VALUES ($1,$2,$3,$4,$5)',
      [policyId, kind, days, effectiveFrom, toInstant(now())],
    );
    await recordLedger(client, { id: person.id, name: person.name }, 'policy_scheduled', null, null, { kind, days, effectiveFrom });
  });
  broadcast({ type: 'policy_scheduled', data: { policyId, kind, days, effectiveFrom } });
  sendJson(ctx.res, 201, { policy: { id: policyId, kind, days, effectiveFrom, state: 'scheduled' } });
}

export async function withdrawPolicy(ctx: RouteContext): Promise<void> {
  const person = ctx.person!;
  if (person.staffRole !== 'admin') throw new ApiError('forbidden');
  const id = ctx.params['id']!;
  const res = await pool.query<{ kind: string; days: string; effective_from: string }>(
    'SELECT kind, days::text AS days, effective_from::text AS effective_from FROM policies WHERE id = $1', [id],
  );
  const policy = res.rows[0];
  if (!policy) throw new ApiError('not_found');
  const today = todayPhoenix(now());
  if (policy['effective_from'] <= today) throw new ApiError('policy_started');
  await withTransaction(async (client) => {
    await client.query('DELETE FROM policies WHERE id = $1', [id]);
    await recordLedger(client, { id: person.id, name: person.name }, 'policy_withdrawn', null, null, { kind: policy['kind'], effectiveFrom: policy['effective_from'] });
  });
  broadcast({ type: 'policy_withdrawn', data: { policyId: id, kind: policy['kind'] } });
  ctx.res.writeHead(204);
  ctx.res.end();
}
