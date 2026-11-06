import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

export type Queryable = Pick<pg.PoolClient, 'query'>;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function applySchema(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url));
  const sql = await readFile(resolve(here, 'schema.sql'), 'utf8');
  await pool.query(sql);
}

export async function tx<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (cause) {
    await client.query('rollback');
    throw cause;
  } finally {
    client.release();
  }
}
