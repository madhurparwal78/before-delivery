import { Pool, type PoolClient } from 'pg';
import { config } from '../config.js';
import schemaSql from './schema.sql';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends Record<string, unknown>>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: readonly unknown[] = []): Promise<number> {
  const result = await pool.query(sql, params as unknown[]);
  return result.rowCount ?? 0;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_LOCK = 528_491;

/** The app waits and retries for Postgres before listening. */
export async function waitForPostgres(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/** Applied idempotently on every serve; two instances may start at once. */
export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    await client.query(schemaSql);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
    client.release();
  }
}

export async function withSeedLock<T>(run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK + 1]);
    return await run();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK + 1]);
    client.release();
  }
}
