import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../env';
import { SCHEMA_SQL } from './schema';

// Dates are library-local calendar days; keep them as the text Postgres sends.
types.setTypeParser(1082, (value) => value);
// Keep integer-valued numerics as numbers rather than strings.
types.setTypeParser(20, (value) => Number(value));

export const pool = new Pool({ connectionString: env.databaseUrl, max: 12 });

export type Row = QueryResultRow;

export async function query<T extends Row>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await run(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const MIGRATION_LOCK = 528_341;

/** Applies the schema, taking a session-wide lock so several instances may boot together. */
export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(SCHEMA_SQL);
  } finally {
    await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => undefined);
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** Serialises seeding and other boot work that several instances must not duplicate. */
export async function withAdvisoryLock<T>(key: number, run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [key]);
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}

export const SEED_LOCK = 528_342;
export const CATALOG_LOCK = 528_343;
