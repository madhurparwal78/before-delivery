import { execute, queryOne } from '../db/index.js';

export type RateKind = 'signin' | 'resend' | 'question';

export interface RateVerdict {
  allowed: boolean;
  retryAfter: number;
}

/** Server-side rolling windows; each refusal states when to try again. */
export async function checkRate(
  kind: RateKind,
  subject: string,
  limit: number,
  windowSeconds: number,
): Promise<RateVerdict> {
  const row = await queryOne<{ used: string; oldest: Date | null }>(
    `SELECT count(*)::text AS used, min(happened_at) AS oldest
     FROM rate_events
     WHERE kind = $1 AND subject = $2 AND happened_at > now() - make_interval(secs => $3)`,
    [kind, subject, windowSeconds],
  );
  const used = Number(row?.used ?? '0');
  if (used < limit) return { allowed: true, retryAfter: 0 };
  const oldest = row?.oldest ?? new Date();
  const elapsed = (Date.now() - oldest.getTime()) / 1000;
  return { allowed: false, retryAfter: Math.max(1, Math.ceil(windowSeconds - elapsed)) };
}

export async function recordRateEvent(kind: RateKind, subject: string): Promise<void> {
  await execute('INSERT INTO rate_events (kind, subject) VALUES ($1, $2)', [kind, subject]);
}
