import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

const DATE_OID = 1082;
// Kitchen dates are `YYYY-MM-DD` strings throughout the rules, so they must not
// pass through a JavaScript Date and pick up the host process's zone.
types.setTypeParser(DATE_OID, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

/** `tstzrange` and `numeric` come back as strings, which is what the rules want. */
export interface Db {
  query<R extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R[]>;
  one<R extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R>;
  maybeOne<R extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<R | null>;
}

function wrap(runner: Pool | PoolClient): Db {
  return {
    async query<R extends QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<R[]> {
      const result = await runner.query<R>(sql, params as unknown[]);
      return result.rows;
    },
    async one<R extends QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<R> {
      const result = await runner.query<R>(sql, params as unknown[]);
      const first = result.rows[0];
      if (first === undefined) throw new Error('expected exactly one row');
      return first;
    },
    async maybeOne<R extends QueryResultRow>(
      sql: string,
      params: readonly unknown[] = [],
    ): Promise<R | null> {
      const result = await runner.query<R>(sql, params as unknown[]);
      return result.rows[0] ?? null;
    },
  };
}

export const db: Db = wrap(pool);

/** Postgres error code for an exclusion-constraint violation. */
export const EXCLUSION_VIOLATION = '23P01';
export const UNIQUE_VIOLATION = '23505';

export function pgErrorCode(error: unknown): string | null {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === 'string') return code;
  }
  return null;
}

/** Runs `body` in one database transaction. Every multi-step change uses this. */
export async function transaction<T>(body: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await body(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises work that must not run twice across concurrently started copies. */
export async function withAdvisoryLock<T>(key: number, body: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key]);
    return await body();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key]);
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      process.stdout.write('waiting for postgres…\n');
      await new Promise((resolve) => setTimeout(resolve, 2_000));
    }
  }
}
