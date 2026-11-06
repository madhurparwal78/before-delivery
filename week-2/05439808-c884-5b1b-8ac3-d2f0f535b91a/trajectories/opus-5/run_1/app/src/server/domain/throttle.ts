import { takeTextLock, withTransaction } from '../db.js';
import { fail } from '../http/errors.js';

export const THROTTLES = {
  signin: { limit: 5, windowSeconds: 60 },
  forgot: { limit: 3, windowSeconds: 60 },
  resend: { limit: 3, windowSeconds: 60 },
  chat: { limit: 5, windowSeconds: 10 }
} as const;

export type ThrottleName = keyof typeof THROTTLES;

/**
 * Counts in a transaction of its own, so a refused or failed request still
 * leaves exactly the hits the sliding window should hold.
 */
export async function enforceThrottle(
  name: ThrottleName,
  subject: string,
  at: Date
): Promise<void> {
  const { limit, windowSeconds } = THROTTLES[name];
  const bucket = `${name}:${subject}`;
  const refusal = await withTransaction(async (client) => {
    await takeTextLock(client, 'throttle', bucket);
    const windowStart = new Date(at.getTime() - windowSeconds * 1000);
    const { rows } = await client.query<{ hits: number; oldest: Date | null }>(
      `SELECT COUNT(*)::int AS hits, MIN(at) AS oldest FROM throttle_hits
        WHERE bucket = $1 AND at > $2`,
      [bucket, windowStart.toISOString()]
    );
    const row = rows[0];
    const hits = row ? Number(row.hits) : 0;
    if (hits >= limit && row?.oldest) {
      const freeAt = row.oldest.getTime() + windowSeconds * 1000;
      return Math.max(1, Math.ceil((freeAt - at.getTime()) / 1000));
    }
    await client.query('INSERT INTO throttle_hits (bucket, at) VALUES ($1, $2)', [
      bucket,
      at.toISOString()
    ]);
    return null;
  });
  if (refusal !== null) fail('rate_limited', {}, refusal);
}
