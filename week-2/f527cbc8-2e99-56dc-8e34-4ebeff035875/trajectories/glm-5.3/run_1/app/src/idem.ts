import crypto from 'node:crypto';
import { connectDb, withTx, type Tx, type Row } from './db.js';
import { config } from './config.js';
import { now } from './time.js';

/** Idempotency claims shared through Postgres (Idempotency, DP-52, DP-70). */
export type IdemResult =
  | { kind: 'fresh'; proceed: true }
  | { kind: 'replay'; status: number; body: string }
  | { kind: 'in_progress' }
  | { kind: 'conflict' }
  | { kind: 'takeover'; proceed: true };

function bodyHash(parsed: unknown, raw: Buffer | null): string {
  if (raw) return crypto.createHash('sha256').update(raw).digest('hex');
  return crypto.createHash('sha256').update(JSON.stringify(parsed ?? null)).digest('hex');
}

export interface ClaimOutcome {
  kind: 'fresh' | 'replay' | 'in_progress' | 'conflict' | 'takeover';
  status?: number;
  body?: string;
}

export async function claimIdempotency(
  userId: string,
  route: string,
  key: string,
  parsed: unknown,
  raw: Buffer | null
): Promise<ClaimOutcome> {
  const hash = bodyHash(parsed, raw);
  return withTx(async tx => {
    await tx.query(`select pg_advisory_xact_lock(hashtext($1))`, [`idem:${userId}:${route}:${key}`]);
    const existing = await tx.query(
      `select * from idem_claims where user_id = $1 and route = $2 and key = $3`,
      [userId, route, key]
    );
    if (existing.length === 0) {
      await tx.query(
        `insert into idem_claims(user_id, route, key, request_hash, status, lease_expires_at, created_at)
         values($1,$2,$3,$4,'in_progress',$5,$6)`,
        [userId, route, key, hash, new Date(now().getTime() + config.idempotencyLeaseSeconds * 1000), now()]
      );
      return { kind: 'fresh' as const };
    }
    const row = existing[0];
    if (row.request_hash !== hash) return { kind: 'conflict' as const };
    if (row.status === 'done') {
      return { kind: 'replay' as const, status: row.response_status ?? 200, body: row.response_body ?? '{}' };
    }
    if (row.lease_expires_at.getTime() > now().getTime()) {
      return { kind: 'in_progress' as const };
    }
    await tx.query(
      `update idem_claims set lease_expires_at = $4 where user_id = $1 and route = $2 and key = $3`,
      [userId, route, key, new Date(now().getTime() + config.idempotencyLeaseSeconds * 1000)]
    );
    return { kind: 'takeover' as const };
  });
}

export async function completeIdempotency(userId: string, route: string, key: string, status: number, body: string): Promise<void> {
  await withTx(async tx => {
    await tx.query(
      `update idem_claims set status = 'done', response_status = $4, response_body = $5
       where user_id = $1 and route = $2 and key = $3`,
      [userId, route, key, status, body]
    );
  });
}

export async function releaseIdempotency(userId: string, route: string, key: string): Promise<void> {
  await withTx(async tx => {
    await tx.query(`delete from idem_claims where user_id = $1 and route = $2 and key = $3 and status = 'in_progress'`, [userId, route, key]);
  });
}
