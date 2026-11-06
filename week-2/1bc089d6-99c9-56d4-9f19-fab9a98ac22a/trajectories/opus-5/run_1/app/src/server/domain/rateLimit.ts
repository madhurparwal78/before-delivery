import { query } from '../db.js';
import { ApiError } from '../errors.js';

export type LimitKind = 'plan' | 'signin';

const WINDOW_MILLIS = 60 * 60 * 1000;
const LIMITS: Record<LimitKind, number> = { plan: 3, signin: 5 };

/**
 * Counts one accepted request for this address, or refuses it with the seconds left
 * until the oldest counted request falls out of the hour.
 */
export async function countRequest(kind: LimitKind, email: string, at: Date): Promise<void> {
  const since = new Date(at.getTime() - WINDOW_MILLIS);
  const counted = await query<{ counted_at: Date }>(
    'select counted_at from request_counts where email = $1 and kind = $2 and counted_at > $3 order by counted_at',
    [email, kind, since],
  );
  if (counted.rowCount! >= LIMITS[kind]) {
    const oldest = counted.rows[0]!.counted_at;
    const seconds = Math.max(1, Math.ceil((oldest.getTime() + WINDOW_MILLIS - at.getTime()) / 1000));
    throw new ApiError('rate_limited', { headers: { 'Retry-After': String(seconds) } });
  }
  await query('insert into request_counts (email, kind, counted_at) values ($1, $2, $3)', [email, kind, at]);
}
