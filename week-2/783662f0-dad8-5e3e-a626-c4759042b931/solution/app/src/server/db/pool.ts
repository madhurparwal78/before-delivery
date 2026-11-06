import pg from 'pg';
import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';
import { fail } from '../errors.js';

/* `pg` ships as CommonJS, so its classes come from the default export. */
const { Pool: PgPool } = pg;

let pool: Pool | null = null;
let ready = false;

function db(): Pool {
  if (pool === null) {
    pool = new PgPool({ connectionString: config().databaseUrl, max: 12 });
    pool.on('error', () => {
      ready = false;
    });
  }
  return pool;
}

export const databaseReady = (): boolean => ready;

/** Postgres is retried every 2 seconds until it connects. */
export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      const client = await db().connect();
      client.release();
      ready = true;
      return;
    } catch {
      ready = false;
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const result = await db().query<T>(sql, params as unknown[]);
    ready = true;
    return result.rows;
  } catch (error) {
    throw translate(error);
  }
}

export async function one<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

/**
 * Runs `work` while holding a session advisory lock. The lock and its release
 * must happen on one connection, so a single client is held for both.
 */
export async function withLock<T>(key: number, run: () => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await db().connect();
  } catch (error) {
    throw translate(error);
  }
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key]);
    try {
      return await run();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } catch (error) {
    throw translate(error);
  } finally {
    client.release();
  }
}

/** A stable 32-bit key for an advisory lock on a record. */
export function lockKey(value: string): number {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return hash;
}

export async function tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await db().connect();
  } catch (error) {
    throw translate(error);
  }
  try {
    await client.query('BEGIN');
    const value = await run(client);
    await client.query('COMMIT');
    ready = true;
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already gone; the transaction is discarded anyway */
    }
    throw translate(error);
  } finally {
    client.release();
  }
}

const CONNECTION_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ECONNRESET',
  '57P01',
  '57P03',
  '08006',
  '08001',
  '08004',
  '53300',
]);

function translate(error: unknown): unknown {
  const code = typeof error === 'object' && error !== null ? Reflect.get(error, 'code') : undefined;
  if (typeof code === 'string' && CONNECTION_CODES.has(code)) {
    ready = false;
    return fail('database_unavailable');
  }
  return error;
}
