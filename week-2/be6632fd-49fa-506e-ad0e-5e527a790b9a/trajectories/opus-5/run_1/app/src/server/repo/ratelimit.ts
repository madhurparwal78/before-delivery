import { config } from '../config.ts';
import { transact } from '../db/pool.ts';
import { STATUS_COPY } from '../../domain/copy.ts';
import { rateLimited } from '../http/errors.ts';
import { sha256Hex } from '../services/crypto.ts';

const WAITLIST_BUCKET = 'waitlist_join';

function lockKey(bucket: string, clientKey: string): number {
  const digest = sha256Hex(`${bucket}:${clientKey}`).slice(0, 8);
  return Number.parseInt(digest, 16) | 0;
}

/**
 * Counts one waitlist join against a client address, across every running app copy. Every request
 * that reaches this check counts, whatever its later outcome; a refused request does not.
 */
export async function countWaitlistJoin(clientKey: string, nowMs: number): Promise<void> {
  const windowMs = config.rateLimit.waitlistWindowSeconds * 1000;
  await transact(async (tx) => {
    await tx.query('select pg_advisory_xact_lock($1)', [lockKey(WAITLIST_BUCKET, clientKey)]);
    await tx.query('delete from rate_events where at_ms <= $1', [nowMs - windowMs]);
    const rows = await tx.query<{ at_ms: number }>(
      `select at_ms from rate_events
        where bucket = $1 and client_key = $2 and at_ms > $3
        order by at_ms`,
      [WAITLIST_BUCKET, clientKey, nowMs - windowMs],
    );
    if (rows.length >= config.rateLimit.waitlistMax) {
      const oldest = Number(rows[0]?.at_ms ?? nowMs);
      const seconds = Math.max(1, Math.ceil((oldest + windowMs - nowMs) / 1000));
      throw rateLimited(seconds, STATUS_COPY.waitlistRateLimited(seconds));
    }
    await tx.query('insert into rate_events (bucket, client_key, at_ms) values ($1,$2,$3)', [
      WAITLIST_BUCKET,
      clientKey,
      nowMs,
    ]);
  });
}
