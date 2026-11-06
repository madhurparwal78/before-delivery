/**
 * The PostgreSQL pool. PostgreSQL holds every piece of shared state, so two
 * instances on one database behave as one shop.
 *
 * The server starts even with the database down: `/api/health` still answers
 * and data routes report `database_unreachable` until it returns.
 */

import { Pool, types, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';

// A `date` column is a calendar day, not an instant: keep it as `YYYY-MM-DD`
// so due dates and delivery dates never drift through a time zone.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL is required');

export const pool = new Pool({
  connectionString,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

// A pool error on an idle client must not take the process down.
pool.on('error', (error) => {
  console.error('[db] idle client error', error.message);
});

export class DatabaseUnreachable extends Error {
  constructor(cause: unknown) {
    super(`database unreachable: ${cause instanceof Error ? cause.message : String(cause)}`);
    this.name = 'DatabaseUnreachable';
  }
}

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as NodeJS.ErrnoException).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ECONNRESET' ||
    code === '57P03' || // cannot_connect_now
    code === '53300' || // too_many_connections
    /timeout exceeded when trying to connect|Connection terminated/i.test(error.message)
  );
}

/**
 * Anything that can run a statement: the pool for plain reads, or a client
 * inside a transaction.
 */
export interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<T>>;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<QueryResult<T>> {
  try {
    return await pool.query<T>(text, values as unknown[]);
  } catch (error) {
    if (isConnectionFailure(error)) throw new DatabaseUnreachable(error);
    throw error;
  }
}

/** Run a unit of work in one transaction. */
export async function transact<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new DatabaseUnreachable(error);
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isConnectionFailure(error)) throw new DatabaseUnreachable(error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Hold a PostgreSQL advisory lock for the duration of `work`, so instances
 * starting at once apply schema and seed safely.
 */
export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new DatabaseUnreachable(error);
  }
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key]);
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}

/** The pool as a `Queryable`, for reads that need no transaction. */
export const poolQueryable: Queryable = {
  query: <T extends QueryResultRow = QueryResultRow>(text: string, values?: readonly unknown[]) =>
    query<T>(text, values ?? []),
};

export async function isDatabaseUp(): Promise<boolean> {
  try {
    await query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
