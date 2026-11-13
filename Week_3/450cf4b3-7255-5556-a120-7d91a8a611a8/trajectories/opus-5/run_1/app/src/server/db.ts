import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';
import { SCHEMA_SQL } from './schema';

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  application_name: 'stationhouse',
});

export type Db = PoolClient;

export const PG_EXCLUSION_VIOLATION = '23P01';
export const PG_DEADLOCK = '40P01';
export const PG_SERIALIZATION_FAILURE = '40001';

export function errorCode(error: unknown): string | null {
  if (error !== null && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

export async function query<T extends QueryResultRow>(
  client: Db,
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T[]> {
  const result = await client.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  client: Db,
  sql: string,
  params: ReadonlyArray<unknown> = [],
): Promise<T | null> {
  const rows = await query<T>(client, sql, params);
  return rows[0] ?? null;
}

/** Runs fn in one transaction, retrying contention failures from Postgres. */
export async function withTransaction<T>(fn: (client: Db) => Promise<T>, attempts = 5): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await fn(client);
      await client.query('commit');
      return result;
    } catch (error) {
      try {
        await client.query('rollback');
      } catch {
        // the connection is being discarded anyway
      }
      const code = errorCode(error);
      if (code === PG_DEADLOCK || code === PG_SERIALIZATION_FAILURE) {
        lastError = error;
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
  throw lastError;
}

/** The Postgres clock at the start of the running transaction. */
export async function transactionNow(client: Db): Promise<Date> {
  const row = await queryOne<{ now: Date }>(client, 'select now() as now');
  if (row === null) throw new Error('Postgres returned no clock reading');
  return row.now;
}

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', ['stationhouse-schema']);
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      await client.query('select pg_advisory_unlock(hashtext($1))', ['stationhouse-schema']);
    }
  } finally {
    client.release();
  }
}
