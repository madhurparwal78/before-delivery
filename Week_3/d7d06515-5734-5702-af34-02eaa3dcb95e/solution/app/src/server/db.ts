// Postgres access: one pool, parameterised queries, transactions, and the idempotent schema migration.
import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.ts';
import { SCHEMA } from './schema.ts';

// bigint columns hold handle counters and creation order, far below 2^53; date columns stay YYYY-MM-DD text.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export type Queryable = Pick<PoolClient, 'query'>;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  query_timeout: 20000,
  keepAlive: true,
});

// A dropped idle connection must not take the process down; the provider loop reports the outage.
pool.on('error', () => undefined);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIGRATION_LOCK = 4173001;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}

export async function query<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(sql, [...params]);
  return result.rows;
}

export async function transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    client.release();
    return result;
  } catch (error) {
    const rolledBack = await client.query('ROLLBACK').then(() => true, () => false);
    client.release(rolledBack ? undefined : true);
    throw error;
  }
}

/** Applies the schema once; instances starting together queue on the advisory lock. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
    }
    client.release();
  } catch (error) {
    client.release(true);
    throw error;
  }
}
