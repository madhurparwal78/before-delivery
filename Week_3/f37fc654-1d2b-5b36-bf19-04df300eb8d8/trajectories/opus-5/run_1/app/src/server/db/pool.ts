import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env.js';

const { Pool, types } = pg;

// Keep bigint money and numeric room sizes as JS numbers; every money value is
// integer cents well inside the safe range.
types.setTypeParser(20, (value: string) => Number.parseInt(value, 10));
types.setTypeParser(1700, (value: string) => Number.parseFloat(value));
// Keep DATE columns as the plain venue-local calendar date they hold.
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  // A dropped idle connection is replaced by the pool; nothing to do here.
});

export type QueryParam = string | number | boolean | null | Date | string[] | object;

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly QueryParam[],
  ): Promise<pg.QueryResult<R>>;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: readonly QueryParam[] = [],
): Promise<pg.QueryResult<R>> {
  return pool.query<R>(sql, params as unknown[]);
}

/** Run the callback inside one database transaction. */
export async function withTransaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn({
      query: <R extends pg.QueryResultRow = pg.QueryResultRow>(
        sql: string,
        params: readonly QueryParam[] = [],
      ) => client.query<R>(sql, params as unknown[]),
    });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const here = dirname(fileURLToPath(import.meta.url));

/** Apply the schema. Safe to run on every start. */
export async function applySchema(): Promise<void> {
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function databaseIsUp(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
