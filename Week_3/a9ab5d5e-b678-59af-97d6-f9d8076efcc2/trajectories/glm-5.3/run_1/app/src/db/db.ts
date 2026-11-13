/** Postgres access: pool, transactions, and the gapless per-household log. */
import { Pool, PoolClient } from 'pg';
import { randomBytes } from 'node:crypto';

export interface LogEntry {
  seq: string;
  at: string;
  actor: 'planning' | 'other' | 'system';
  type: string;
  subjectId: string | null;
}

/** Append one log entry inside the caller's transaction, in commit order,
 *  gapless per household. Uses the household row lock to serialise. */
export async function appendLog(
  client: PoolClient,
  householdId: string,
  actor: 'planning' | 'other' | 'system',
  type: string,
  subjectId: string | null,
): Promise<bigint> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [householdId]);
  const res = await client.query(
    `UPDATE households SET log_seq = log_seq + 1 WHERE id=$1 RETURNING log_seq`,
    [householdId],
  );
  const seq = res.rows[0].log_seq as bigint;
  await client.query(
    `INSERT INTO log_entries (household_id, seq, actor, type, subject_id) VALUES ($1,$2,$3,$4,$5)`,
    [householdId, seq, actor, type, subjectId],
  );
  return seq;
}

export function nextId(prefix?: string): string {
  const raw = randomBytes(12).toString('hex');
  const n = BigInt('0x' + raw).toString();
  return prefix ? prefix : n;
}

export async function withTransaction<T>(pool: Pool, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken
    }
    throw e;
  } finally {
    client.release();
  }
}

export function dbUrlToConfig(url: string): { connectionString: string } {
  return { connectionString: url };
}
