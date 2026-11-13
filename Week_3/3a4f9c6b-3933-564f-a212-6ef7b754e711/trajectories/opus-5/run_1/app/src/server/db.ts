import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type QueryValue = string | number | boolean | null | Date | Buffer | string[] | object;

export async function query<Row extends pg.QueryResultRow>(
  sql: string,
  values: readonly QueryValue[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(sql, values as unknown[]);
  return result.rows;
}

export async function queryOne<Row extends pg.QueryResultRow>(
  sql: string,
  values: readonly QueryValue[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(sql, values);
  return rows[0] ?? null;
}

export interface Tx {
  query<Row extends pg.QueryResultRow>(sql: string, values?: readonly QueryValue[]): Promise<Row[]>;
  queryOne<Row extends pg.QueryResultRow>(sql: string, values?: readonly QueryValue[]): Promise<Row | null>;
}

/** Lets a reader run inside a caller's transaction or on its own against the pool. */
export function runner(tx?: Tx): Tx {
  return tx ?? { query, queryOne };
}

export async function transaction<Result>(run: (tx: Tx) => Promise<Result>): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Tx = {
      async query(sql, values = []) {
        const result = await client.query(sql, values as unknown[]);
        return result.rows;
      },
      async queryOne(sql, values = []) {
        const result = await client.query(sql, values as unknown[]);
        return result.rows[0] ?? null;
      },
    };
    const outcome = await run(tx);
    await client.query('COMMIT');
    return outcome;
  } catch (cause) {
    await client.query('ROLLBACK');
    throw cause;
  } finally {
    client.release();
  }
}

const UNIQUE_VIOLATION = '23505';

export function isUniqueViolation(cause: unknown, constraint?: string): boolean {
  if (typeof cause !== 'object' || cause === null) return false;
  const error = cause as { code?: string; constraint?: string };
  if (error.code !== UNIQUE_VIOLATION) return false;
  return constraint === undefined || error.constraint === constraint;
}

const BOOT_LOCK_KEY = 8_421_337;

/**
 * Serialises schema and seed application, so several instances starting at once cannot
 * deadlock against each other over the same tables.
 */
export async function withBootLock<Result>(run: () => Promise<Result>): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [BOOT_LOCK_KEY]);
    return await run();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [BOOT_LOCK_KEY]);
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
