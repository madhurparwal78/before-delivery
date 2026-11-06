import type { Pool, PoolClient } from 'pg';
import pg from 'pg';

export type Db = Pool;

export function createPool(databaseUrl: string): Db {
  return new pg.Pool({ connectionString: databaseUrl, max: 10 });
}

export async function withTransaction<T>(db: Db, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

// An advisory lock so start-up steps and sweep effects run exactly once across copies.
export async function withAdvisoryLock<T>(client: PoolClient, key: number, fn: () => Promise<T>): Promise<T | null> {
  const res = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [key]);
  if (!res.rows[0].ok) return null;
  return await fn();
}

export const LOCK_KEYS = {
  sweep: 902100,
  seed: 902200,
  imageSeed: 902300,
  mail: 902400
};
