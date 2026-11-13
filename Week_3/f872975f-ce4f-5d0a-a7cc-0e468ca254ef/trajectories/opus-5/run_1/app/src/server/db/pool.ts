import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Params = ReadonlyArray<unknown>;

export interface Queryable {
  query<Row extends QueryResultRow>(sql: string, params?: Params): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export async function query<Row extends QueryResultRow>(sql: string, params: Params = []): Promise<Row[]> {
  const result = await pool.query<Row>(sql, params as unknown[]);
  return result.rows;
}

export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function rows<Row extends QueryResultRow>(client: Queryable, sql: string, params: Params = []): Promise<Row[]> {
  const result = await client.query<Row>(sql, params);
  return result.rows;
}

export async function one<Row extends QueryResultRow>(client: Queryable, sql: string, params: Params = []): Promise<Row | null> {
  const result = await client.query<Row>(sql, params);
  return result.rows[0] ?? null;
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Serialises work across instances, for example corrections within one lineage. */
export async function advisoryLock(client: Queryable, scope: number, name: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [scope, name]);
}

export const LOCK_SCOPE_LINEAGE = 1;
export const LOCK_SCOPE_MIGRATE = 2;
export const LOCK_SCOPE_TICKET = 3;
export const LOCK_SCOPE_BILLING_ACCOUNT = 4;
