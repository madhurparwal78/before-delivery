import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env.js';

pg.types.setTypeParser(1082, (value: string) => value);

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 12 });

export type Db = pg.Pool | pg.PoolClient;

export async function query<R extends pg.QueryResultRow>(
  db: Db,
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  const result = await db.query<R>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<R extends pg.QueryResultRow>(
  db: Db,
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> {
  const rows = await query<R>(db, text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

export async function applySchema(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(join(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
}
