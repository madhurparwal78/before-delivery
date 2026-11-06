import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.js';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 16,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

// Integer cents and bigint counters are read as numbers; every such column is
// bounded well inside the safe integer range.
import pgPkg from 'pg';
pgPkg.types.setTypeParser(20, (value: string) => Number(value));
pgPkg.types.setTypeParser(1700, (value: string) => Number(value));

export type Db = Pick<PoolClient, 'query'>;

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

/** Runs a unit of work in one transaction. Every race in the brief is settled inside one of these. */
export async function withTransaction<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; releasing it is enough.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function withClient<T>(run: (db: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}
