import pg from 'pg';
import { config } from './config.js';
import { SCHEMA_SQL } from './schema.js';

export type Db = pg.Pool | pg.PoolClient;

// Postgres returns timestamptz as Date and bigint as string; counts are cast to int in SQL.
export const pool = new pg.Pool({
  connectionString: config.databaseUrl ?? undefined,
  max: 20,
  connectionTimeoutMillis: 5000,
});
pool.on('error', (error) => console.error('postgres pool error:', error.message));

export async function rows<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_LOCK = 7_331_001;

/** Applies the schema, then `seed`, under one advisory lock so concurrent starts never race. */
export async function prepareDatabase(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    try {
      await client.query(SCHEMA_SQL);
      await seed(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
    }
  } finally {
    client.release();
  }
}

export async function databaseAnswers(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export const isUniqueViolation = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
