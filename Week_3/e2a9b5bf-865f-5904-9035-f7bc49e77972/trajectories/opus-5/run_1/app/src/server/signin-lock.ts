import type { PoolClient } from 'pg';
import { config } from './config.js';

/**
 * The one place the sign-in lock is decided. Attempts for one email are handled
 * one at a time, so of many simultaneous wrong attempts at most five answer 401.
 */
export async function lockEmailForAttempt(client: PoolClient, email: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`signin:${email}`]);
}

/** The whole seconds left on this email's lock, or null when it is not locked. */
export async function remainingLockSeconds(
  client: PoolClient,
  email: string,
): Promise<number | null> {
  const found = await client.query<{ locked_until: Date }>(
    'SELECT locked_until FROM signin_locks WHERE email = $1',
    [email],
  );
  const row = found.rows[0];
  if (!row) return null;
  const remaining = row.locked_until.getTime() - Date.now();
  if (remaining <= 0) {
    await client.query('DELETE FROM signin_locks WHERE email = $1', [email]);
    return null;
  }
  return Math.max(1, Math.ceil(remaining / 1000));
}

/** Record a failure and lock the email when five fall inside the rolling window. */
export async function recordFailure(client: PoolClient, email: string): Promise<void> {
  await client.query('INSERT INTO signin_failures (email) VALUES ($1)', [email]);
  const counted = await client.query<{ failures: number }>(
    `SELECT count(*)::int AS failures FROM signin_failures
     WHERE email = $1 AND failed_at > now() - make_interval(secs => $2::int)`,
    [email, config.signinLockSeconds],
  );
  const failures = counted.rows[0]?.failures ?? 0;
  if (failures < 5) return;
  await client.query(
    `INSERT INTO signin_locks (email, locked_until)
     VALUES ($1, now() + make_interval(secs => $2::int))
     ON CONFLICT (email) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
    [email, config.signinLockSeconds],
  );
  // The count starts again from zero when the lock ends.
  await client.query('DELETE FROM signin_failures WHERE email = $1', [email]);
}

/** A successful sign-in before the fifth failure resets the count. */
export async function clearFailures(client: PoolClient, email: string): Promise<void> {
  await client.query('DELETE FROM signin_failures WHERE email = $1', [email]);
}
