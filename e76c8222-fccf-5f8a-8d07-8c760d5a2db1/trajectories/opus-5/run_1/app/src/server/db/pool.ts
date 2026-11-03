import { Pool, PoolClient, QueryResultRow, types } from 'pg';
import { config } from '../env';
import { SCHEMA_SQL } from './schema';

const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type Db = Pool | PoolClient;

export async function query<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(db, sql, params);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

/** Serialises cluster-wide background work so several serve instances never duplicate it. */
export async function withAdvisoryLock<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const locked = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock(hashtext($1)) as locked',
      [name],
    );
    if (!locked.rows[0]?.locked) return null;
    try {
      return await run();
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}
