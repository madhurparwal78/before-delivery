import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
  application_name: 'pilotlight',
});

pool.on('error', () => {
  /* a broken idle connection is dropped and replaced by the pool */
});

export type Params = readonly unknown[];

export interface Queryable {
  query<Row extends QueryResultRow>(
    text: string,
    params?: Params,
  ): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export async function query<Row extends QueryResultRow>(
  text: string,
  params: Params = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<Row extends QueryResultRow>(
  text: string,
  params: Params = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, params);
  return rows.length === 0 ? null : (rows[0] as Row);
}

export async function tx<Result>(run: (client: PoolClient) => Promise<Result>): Promise<Result> {
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
      /* the connection is already gone */
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function rows<Row extends QueryResultRow>(
  client: Queryable,
  text: string,
  params: Params = [],
): Promise<Row[]> {
  const result = await client.query<Row>(text, params);
  return result.rows;
}

export async function one<Row extends QueryResultRow>(
  client: Queryable,
  text: string,
  params: Params = [],
): Promise<Row | null> {
  const found = await rows<Row>(client, text, params);
  return found.length === 0 ? null : (found[0] as Row);
}

/** A transaction-scoped advisory lock, so concurrent writers queue instead of racing. */
export async function lock(client: PoolClient, namespace: number, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [namespace, key]);
}

export const LOCK_STATION = 1;
export const LOCK_MEMBER = 2;
export const LOCK_BOOKING = 3;
export const LOCK_SEED = 4;
export const LOCK_SWEEP = 5;
export const LOCK_TRUCK = 6;
