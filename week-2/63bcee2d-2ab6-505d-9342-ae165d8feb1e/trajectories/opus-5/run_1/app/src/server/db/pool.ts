import pg, { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config.js';

// Calendar dates must stay YYYY-MM-DD strings and whole-cent amounts must
// arrive as numbers, so the two type parsers are set once here.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = QueryResultRow;

export interface Queryable {
  query<T extends Row = Row>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export async function rows<T extends Row = Row>(
  client: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function firstRow<T extends Row = Row>(
  client: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const found = await rows<T>(client, text, values);
  return found[0] ?? null;
}

export async function query<T extends Row = Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  return rows<T>(pool, text, values);
}

export async function one<T extends Row = Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  return firstRow<T>(pool, text, values);
}

/** Runs the body in a transaction, rolling back on any thrown error. */
export async function transact<T>(body: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await body(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
