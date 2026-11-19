import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';

export type QueryValue = string | number | boolean | bigint | Date | null | Uint8Array | object;

export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: QueryValue[],
  ): Promise<pg.QueryResult<Row>>;
}

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export const db: Queryable = {
  query: (text, values) => pool.query(text, values as unknown[]),
};

/** Runs the callback inside one PostgreSQL transaction. */
export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Queryable = {
      query: (text, values) => client.query(text, values as unknown[]),
    };
    const result = await run(tx);
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

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: string }).code === UNIQUE_VIOLATION
  );
}
