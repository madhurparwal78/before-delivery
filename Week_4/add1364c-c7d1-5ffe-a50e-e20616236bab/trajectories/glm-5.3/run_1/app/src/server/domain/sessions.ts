import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { officeDateString, officeLocalInstant } from '../officeTime.js';

export type SessionEndReason = 'time_limit' | 'signed_out';

export interface SessionRow {
  id: string;
  person_id: string;
  started_at: Date;
  ends_at: Date;
}

/** Session end: whichever comes first of the reveal-session limit and the next 19:00 office time. */
export function sessionEnd(startedAt: Date, revealSessionSeconds: number): Date {
  const limit = new Date(startedAt.getTime() + revealSessionSeconds * 1000);
  const cutOff = nextEveningCutOff(startedAt);
  return limit.getTime() < cutOff.getTime() ? limit : cutOff;
}

/** The next 19:00 office time after the start instant. */
export function nextEveningCutOff(startedAt: Date): Date {
  const officeDay = officeDateString(startedAt);
  const sameDayCutOff = officeLocalInstant(officeDay, '19:00');
  if (sameDayCutOff.getTime() > startedAt.getTime()) return sameDayCutOff;
  const nextDay = officeDateString(new Date(startedAt.getTime() + 36 * 3600 * 1000));
  return officeLocalInstant(nextDay, '19:00');
}

/**
 * Sign-in lockout: five failed sign-ins for one handle within the lock window lock
 * that handle for the window. Counts and locks are kept in Postgres.
 */
export class SignInLockout {
  constructor(
    private readonly pool: pg.Pool,
    private readonly lockSeconds: number
  ) {}

  private windowStart(now: Date): Date {
    return new Date(now.getTime() - this.lockSeconds * 1000);
  }

  /** Whether a handle is locked now, and until when. */
  async lockState(handle: string, now: Date): Promise<{ locked: boolean; until: Date | null }> {
    const rows = await this.pool.query(
      'SELECT locked_until FROM sign_in_failures WHERE handle = $1 AND locked_until > $2 ORDER BY locked_until DESC LIMIT 1',
      [handle, now]
    );
    if (rows.rows.length === 0) return { locked: false, until: null };
    return { locked: true, until: rows.rows[0].locked_until as Date };
  }

  /** Record a failure and lock when the fifth lands inside the window. */
  async recordFailure(handle: string, now: Date): Promise<{ locked: boolean; until: Date | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        "INSERT INTO sign_in_failures (id, handle, at) VALUES ($1, $2, $3)",
        [randomUUID(), handle, now]
      );
      const rows = await client.query(
        'SELECT COUNT(*)::int AS n, MAX(at) AS latest FROM sign_in_failures WHERE handle = $1 AND at >= $2',
        [handle, this.windowStart(now)]
      );
      const count = rows.rows[0].n as number;
      let lockedUntil: Date | null = null;
      if (count >= 5) {
        lockedUntil = new Date(now.getTime() + this.lockSeconds * 1000);
        await client.query(
          'UPDATE sign_in_failures SET locked_until = $3 WHERE handle = $1 AND at = $2',
          [handle, rows.rows[0].latest, lockedUntil]
        );
      }
      await client.query('COMMIT');
      return { locked: lockedUntil !== null, until: lockedUntil };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /** A successful sign-in resets that handle's count. */
  async reset(handle: string): Promise<void> {
    await this.pool.query('DELETE FROM sign_in_failures WHERE handle = $1', [handle]);
  }
}
