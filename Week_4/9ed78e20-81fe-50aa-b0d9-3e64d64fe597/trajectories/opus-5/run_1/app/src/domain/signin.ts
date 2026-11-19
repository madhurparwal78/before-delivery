import { config } from '../config.js';
import { query } from '../db/pool.js';

const MAX_FAILURES = 5;
const MAX_LOCK_MULTIPLIER = 8;

export type LockState = { readonly locked: boolean; readonly retryAfter: number };

export async function lockState(email: string): Promise<LockState> {
  const result = await query<{ retry_after: number }>(
    `SELECT GREATEST(1, ceil(extract(epoch from (locked_until - now()))))::int AS retry_after
       FROM signin_attempts
      WHERE email = $1 AND locked_until IS NOT NULL AND locked_until > now()`,
    [email],
  );
  const row = result.rows[0];
  return row === undefined
    ? { locked: false, retryAfter: 0 }
    : { locked: true, retryAfter: row.retry_after };
}

/** Counts a failed sign-in and locks the email with a doubling lockout. */
export async function recordFailure(email: string): Promise<void> {
  const current = await query<{ failures: number; lock_count: number }>(
    `INSERT INTO signin_attempts (email, failures, lock_count)
     VALUES ($1, 1, 0)
     ON CONFLICT (email) DO UPDATE SET failures = signin_attempts.failures + 1
     RETURNING failures, lock_count`,
    [email],
  );
  const row = current.rows[0];
  if (row === undefined) return;
  // The first lock needs five failures; after a lock has ended one failure locks again.
  if (row.lock_count === 0 && row.failures < MAX_FAILURES) return;
  const multiplier = Math.min(2 ** row.lock_count, MAX_LOCK_MULTIPLIER);
  await query(
    `UPDATE signin_attempts
        SET failures = 0,
            lock_count = lock_count + 1,
            locked_until = now() + ($2 || ' seconds')::interval
      WHERE email = $1`,
    [email, String(config.signinLockoutSeconds * multiplier)],
  );
}

export async function recordSuccess(email: string): Promise<void> {
  await query(
    `INSERT INTO signin_attempts (email, failures, lock_count, locked_until)
     VALUES ($1, 0, 0, NULL)
     ON CONFLICT (email) DO UPDATE SET failures = 0, lock_count = 0, locked_until = NULL`,
    [email],
  );
}
