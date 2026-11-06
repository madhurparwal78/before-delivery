// The sign-in lockout state: open, locked for one window after the threshold failure, open again.
import { config } from './config.ts';
import type { Tx } from './db.ts';

export interface Identity { kind: 'email' | 'address'; value: string; threshold: number }

export const EMAIL_FAILURES = 5;
export const ADDRESS_FAILURES = 50;

const windowSeconds = (): number => config.lockoutWindowSeconds;

/** Seconds until the latest lock among the identities lifts, or 0 when sign-in is open. */
export async function lockedFor(tx: Tx, identities: Identity[]): Promise<number> {
  let longest = 0;
  for (const id of identities) {
    const [row] = await tx.query<{ left: number }>(
      `SELECT extract(epoch FROM locked_until - now())::float8 AS left FROM sign_in_locks
        WHERE identity_kind = $1 AND identity = $2 AND locked_until > now()`, [id.kind, id.value]);
    if (row) longest = Math.max(longest, row.left);
  }
  return longest;
}

/** Counts a failure for each identity; the threshold failure locks it for one window. Returns seconds locked, or 0. */
export async function recordFailure(tx: Tx, identities: Identity[]): Promise<number> {
  for (const id of identities) {
    await tx.query('INSERT INTO sign_in_failures (identity_kind, identity, failed_at) VALUES ($1, $2, now())', [id.kind, id.value]);
    const [{ count }] = await tx.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM sign_in_failures
        WHERE identity_kind = $1 AND identity = $2 AND failed_at > now() - make_interval(secs => $3)`,
      [id.kind, id.value, windowSeconds()]);
    if (count >= id.threshold) {
      await tx.query(
        `INSERT INTO sign_in_locks (identity_kind, identity, locked_until) VALUES ($1, $2, now() + make_interval(secs => $3))
         ON CONFLICT (identity_kind, identity) DO UPDATE SET locked_until = EXCLUDED.locked_until`,
        [id.kind, id.value, windowSeconds()]);
      await tx.query('DELETE FROM sign_in_failures WHERE identity_kind = $1 AND identity = $2', [id.kind, id.value]);
    }
  }
  return lockedFor(tx, identities);
}

export async function clearFailures(tx: Tx, identity: Identity): Promise<void> {
  await tx.query('DELETE FROM sign_in_failures WHERE identity_kind = $1 AND identity = $2', [identity.kind, identity.value]);
}

export const retryAfter = (seconds: number): string => String(Math.max(1, Math.ceil(seconds)));
