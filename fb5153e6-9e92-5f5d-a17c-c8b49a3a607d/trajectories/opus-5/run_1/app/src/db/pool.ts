import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  /* A dropped idle connection is replaced on the next query. */
});

export async function query<T extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, values);
  return rows[0] ?? null;
}

/** Runs a unit of work in one transaction. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseUp(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
