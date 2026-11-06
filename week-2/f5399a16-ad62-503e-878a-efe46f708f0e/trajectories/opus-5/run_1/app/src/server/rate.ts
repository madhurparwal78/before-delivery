import { query } from './infra/db.js';

export type RateVerdict = { allowed: true } | { allowed: false; retryAt: Date };

/**
 * A window of hits kept in Postgres, so every copy of the app counts its own.
 * The sixth hit in a window is refused until the oldest of the five has aged out.
 */
export async function takeHit(
  bucket: string,
  limit: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  const since = new Date(Date.now() - windowSeconds * 1000);
  const hits = await query<{ at: Date }>(
    'select at from rate_hits where bucket = $1 and at > $2 order by at asc',
    [bucket, since],
  );
  if (hits.length >= limit) {
    const oldest = hits[hits.length - limit]?.at ?? new Date();
    return { allowed: false, retryAt: new Date(oldest.getTime() + windowSeconds * 1000) };
  }
  await query('insert into rate_hits (bucket, at) values ($1, now())', [bucket]);
  return { allowed: true };
}
