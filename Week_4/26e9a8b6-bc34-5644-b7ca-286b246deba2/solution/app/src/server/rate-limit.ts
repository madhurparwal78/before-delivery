import { createHash } from 'node:crypto';
import type { Db } from './db';
import { one } from './db';
import { rateLimited } from './errors';

export function lockKey(bucket: string, subject: string): string {
  return createHash('sha256').update(`${bucket}|${subject}`).digest().readBigInt64BE(0).toString();
}

/** Takes the rolling-window lock for one subject; the lock ends with the surrounding transaction. */
export async function lockWindow(db: Db, bucket: string, subject: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey(bucket, subject)]);
}

/** Throws the rate-limit refusal when the subject already used its allowance in the window. */
export async function enforceWindow(db: Db, bucket: string, subject: string, limit: number, windowSeconds: number): Promise<void> {
  const row = await one<{ used: string; wait: number | null }>(
    db,
    `SELECT count(*) AS used, ceil($4::int - extract(epoch FROM now() - min(at)))::int AS wait
       FROM rate_events WHERE bucket = $1 AND subject = $2 AND at > now() - make_interval(secs => $3)`,
    [bucket, subject, windowSeconds, windowSeconds],
  );
  if (row && Number(row.used) >= limit) throw rateLimited(Math.max(1, row.wait ?? windowSeconds));
}

export async function recordEvent(db: Db, bucket: string, subject: string): Promise<void> {
  await db.query('INSERT INTO rate_events (bucket, subject) VALUES ($1, $2)', [bucket, subject]);
}
