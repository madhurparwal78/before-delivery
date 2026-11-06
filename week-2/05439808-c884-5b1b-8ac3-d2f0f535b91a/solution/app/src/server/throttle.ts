// Sliding-window throttles stored in PostgreSQL. Checking and counting happen under one lock per key.
import { now } from './clock';
import { tx } from './db';
import { fail } from './errors';
import type { ThrottleRule } from './http';

export const SIGNIN_LIMIT: Omit<ThrottleRule, 'key'> = { limit: 5, windowMs: 60000 };
export const FORGOT_LIMIT: Omit<ThrottleRule, 'key'> = { limit: 3, windowMs: 60000 };
export const RESEND_LIMIT: Omit<ThrottleRule, 'key'> = { limit: 3, windowMs: 60000 };
export const CHAT_LIMIT: Omit<ThrottleRule, 'key'> = { limit: 5, windowMs: 10000 };

export async function throttle(rule: ThrottleRule): Promise<void> {
  await tx(async (db) => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 7))', [rule.key]);
    const at = now();
    const { rows } = await db.query<{ at: number }>(
      'SELECT at FROM throttle_hits WHERE limit_key = $1 AND at > $2 ORDER BY at ASC',
      [rule.key, at - rule.windowMs],
    );
    if (rows.length >= rule.limit) {
      const oldest = (rows[0] as { at: number }).at;
      const retry = Math.max(1, Math.ceil((oldest + rule.windowMs - at) / 1000));
      fail('rate_limited', null, { 'Retry-After': String(retry) });
    }
    await db.query('INSERT INTO throttle_hits (limit_key, at) VALUES ($1, $2)', [rule.key, at]);
  });
}

/** The throttle key for an email-keyed limit, or null when the body carries no email string. */
export function emailKey(prefix: string, body: unknown): string | null {
  const email = typeof body === 'object' && body !== null ? (body as Record<string, unknown>).email : undefined;
  return typeof email === 'string' && email.trim() !== '' ? `${prefix}:${email.trim().toLowerCase()}` : null;
}
