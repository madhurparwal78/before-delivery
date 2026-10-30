import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../config.js';

export type QueryValue = string | number | boolean | Date | null | string[] | undefined;

export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly QueryValue[],
  ): Promise<pg.QueryResult<Row>>;
}

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function one<Row extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values?: readonly QueryValue[],
): Promise<Row | null> {
  const result = await db.query<Row>(text, values);
  return result.rows[0] ?? null;
}

export async function many<Row extends pg.QueryResultRow>(
  db: Queryable,
  text: string,
  values?: readonly QueryValue[],
): Promise<Row[]> {
  const result = await db.query<Row>(text, values);
  return result.rows;
}

export async function applySchema(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function postgresUp(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** Serialises a named critical section across every instance sharing the database. */
export async function withAdvisoryLock<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const locked = await client.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtext($1)) AS acquired',
      [name],
    );
    if (locked.rows[0]?.acquired !== true) return null;
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
    }
  } finally {
    client.release();
  }
}

export async function nextSequence(db: Queryable, name: string): Promise<number> {
  const row = await one<{ value: number }>(
    db,
    `INSERT INTO sequences (name, value) VALUES ($1, 1)
     ON CONFLICT (name) DO UPDATE SET value = sequences.value + 1
     RETURNING value`,
    [name],
  );
  return row?.value ?? 1;
}
