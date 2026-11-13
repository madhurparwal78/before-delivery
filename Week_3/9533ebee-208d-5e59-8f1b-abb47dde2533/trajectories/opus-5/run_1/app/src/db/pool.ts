/**
 * The Postgres connection pool. Dropped connections are replaced by the pool
 * itself, with no restart; while the database is unreachable every request
 * answers `ledger_unavailable`.
 */

import pg from 'pg';
import { config } from '../config.ts';
import { ledgerUnavailable } from '../http/problem.ts';

/**
 * The minimum a caller needs to run a statement: either the pool itself or a
 * client inside a transaction.
 */
export interface Queryable {
  query<Row extends pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<Row>>;
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 4000,
  // keeps a long-lived process from holding a connection the server has closed
  keepAlive: true,
});

// An idle client that errors is discarded by the pool; without a listener the
// error would reach the process as uncaught.
pool.on('error', () => undefined);

/** True when the failure is the database being unreachable rather than a query fault. */
function isConnectionFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') {
    // connection exception, cannot connect now, admin shutdown, crash shutdown,
    // too many connections, operator intervention
    if (
      code.startsWith('08') ||
      code === '57P01' ||
      code === '57P02' ||
      code === '57P03' ||
      code === '53300' ||
      code === 'ECONNREFUSED' ||
      code === 'ENOTFOUND' ||
      code === 'ETIMEDOUT' ||
      code === 'ECONNRESET' ||
      code === 'EHOSTUNREACH' ||
      code === 'EAI_AGAIN'
    ) {
      return true;
    }
  }
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    (message.includes('Connection terminated') ||
      message.includes('connection terminated') ||
      message.includes('timeout exceeded when trying to connect') ||
      message.includes('Client has encountered a connection error'))
  );
}

/** Turns a connection failure into the published 503, and rethrows the rest. */
export function rethrowAsLedgerProblem(error: unknown): never {
  if (isConnectionFailure(error)) throw ledgerUnavailable();
  throw error;
}

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  try {
    return await pool.query<Row>(text, values);
  } catch (error) {
    return rethrowAsLedgerProblem(error);
  }
}

/**
 * Runs a unit of work in one transaction. Everything the callback writes
 * commits together or not at all.
 */
export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return rethrowAsLedgerProblem(error);
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is already gone; the transaction is discarded with it
    }
    return rethrowAsLedgerProblem(error);
  } finally {
    client.release();
  }
}

/** Acquires a session-level advisory lock for the duration of one callback. */
export async function withAdvisoryLock<T>(key: bigint, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key.toString()]);
    try {
      return await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key.toString()]);
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

// ---------------------------------------------------------------------------
// Exact integers across the wire
// ---------------------------------------------------------------------------

/** Reads a numeric(78,0) column, which pg returns as a decimal string. */
export function readBig(value: unknown): bigint {
  if (typeof value === 'string') return BigInt(value);
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number' && Number.isInteger(value)) return BigInt(value);
  throw new TypeError(`Expected an exact integer column, received ${typeof value}`);
}

export function readBigOrNull(value: unknown): bigint | null {
  return value === null || value === undefined ? null : readBig(value);
}

/** Reads a timestamptz column as epoch milliseconds. */
export function readInstant(value: unknown): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') return Date.parse(value);
  throw new TypeError('Expected a timestamptz column');
}

export function readInstantOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : readInstant(value);
}

/** Writes epoch milliseconds as a timestamptz parameter, to the whole second. */
export function writeInstant(instantMs: number): Date {
  return new Date(Math.floor(instantMs / 1000) * 1000);
}
