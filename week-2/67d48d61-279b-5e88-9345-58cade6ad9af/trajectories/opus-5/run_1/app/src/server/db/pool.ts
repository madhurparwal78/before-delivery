import { Pool, type PoolClient } from 'pg';
import { config } from '../env.js';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

/** Advisory lock keys. Every writer takes `write` first, so writes serialise. */
export const LOCK = {
  schema: 918_001,
  write: 918_002,
  pull: 918_003,
  rollover: 918_004,
} as const;

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function takeWriteLock(client: PoolClient): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1)', [LOCK.write]);
}

export async function tryLock(client: PoolClient, key: number): Promise<boolean> {
  const result = await client.query<{ locked: boolean }>(
    'select pg_try_advisory_xact_lock($1) as locked',
    [key],
  );
  return result.rows[0]?.locked === true;
}
