/** Idempotency keys kept in PostgreSQL, so one key makes one effect on any instance sharing the database. */
import { createHash } from 'node:crypto';
import type { Reply } from './http.js';
import { one, query, sql } from './db.js';
import { fail, invalid } from './errors.js';

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : 1));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function fingerprint(method: string, path: string, body: unknown): string {
  return createHash('sha256').update(`${method}\n${path}\n${canonicalJson(body)}`).digest('hex');
}

type KeyRow = { fingerprint: string; body: unknown; stale: boolean } & ({ state: 'running'; status: null } | { state: 'done'; status: number });

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Run `effect` once for a (user, key). A repeat returns the stored answer; the same key with another body is a conflict.
 * Only a successful answer is stored: a refusal before any provider call deletes the claim so the key stays usable.
 */
export async function idempotent(
  userId: string,
  key: string | undefined,
  fingerprintOfRequest: string,
  ownership: () => Promise<void>,
  effect: (key: string) => Promise<Reply>,
): Promise<Reply> {
  for (let waited = 0; waited < 90000;) {
    const existing = key
      ? await one<KeyRow>(sql, "SELECT fingerprint, state, status, body, created_at < now() - interval '60 seconds' AS stale FROM idempotency_keys WHERE user_id = $1 AND key = $2", [userId, key])
      : undefined;
    if (existing) {
      if (existing.fingerprint !== fingerprintOfRequest) throw fail(409, 'idempotency_conflict');
      if (existing.state === 'done') return { status: existing.status, body: existing.body };
      if (existing.stale) {
        await query(sql, "DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2 AND state = 'running'", [userId, key]);
        continue;
      }
      await sleep(50);
      waited += 50;
      continue;
    }
    await ownership();
    if (!key) throw invalid({ idempotencyKey: 'Required.' });
    if (key.length > 200) throw invalid({ idempotencyKey: 'Use at most 200 characters.' });
    const claimed = await one(sql, "INSERT INTO idempotency_keys (user_id, key, fingerprint, state) VALUES ($1,$2,$3,'running') ON CONFLICT DO NOTHING RETURNING key", [userId, key, fingerprintOfRequest]);
    if (!claimed) continue;
    try {
      const reply = await effect(key);
      await query(sql, "UPDATE idempotency_keys SET state = 'done', status = $3, body = $4 WHERE user_id = $1 AND key = $2", [userId, key, reply.status, JSON.stringify(reply.body ?? null)]);
      return reply;
    } catch (error) {
      await query(sql, 'DELETE FROM idempotency_keys WHERE user_id = $1 AND key = $2', [userId, key]);
      throw error;
    }
  }
  throw fail(503, 'payments_paused');
}
