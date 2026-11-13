import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';
import { ApiError, databaseUnavailable } from '../errors.js';
import { markDatabaseDown } from './readiness.js';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 4_000,
  statement_timeout: 20_000,
});

pool.on('error', () => {
  // Idle clients dropped by Postgres are replaced by the pool on next use.
});

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  '08000',
  '08001',
  '08003',
  '08004',
  '08006',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '3D000',
]);

function asDatabaseOutage(error: unknown): ApiError | null {
  if (typeof error !== 'object' || error === null) return null;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  const isOutage =
    (typeof code === 'string' && CONNECTION_ERROR_CODES.has(code)) ||
    (typeof message === 'string' && message.includes('timeout exceeded when trying to connect'));
  if (!isOutage) return null;
  markDatabaseDown();
  return databaseUnavailable();
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, params as unknown[]);
    return result.rows;
  } catch (error) {
    const outage = asDatabaseOutage(error);
    if (outage) throw outage;
    throw error;
  }
}

export interface Tx {
  query<T extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow>(text: string, params?: readonly unknown[]): Promise<T | null>;
}

function makeTx(client: PoolClient): Tx {
  const run = async <T extends QueryResultRow>(
    text: string,
    params: readonly unknown[] = [],
  ): Promise<T[]> => {
    const result = await client.query<T>(text, params as unknown[]);
    return result.rows;
  };
  return {
    query: run,
    queryOne: async <T extends QueryResultRow>(text: string, params: readonly unknown[] = []) =>
      (await run<T>(text, params))[0] ?? null,
  };
}

export async function withTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    const outage = asDatabaseOutage(error);
    if (outage) throw outage;
    throw error;
  }
  try {
    await client.query('BEGIN');
    const result = await run(makeTx(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already broken; releasing it below discards it.
    }
    const outage = asDatabaseOutage(error);
    if (outage) throw outage;
    throw error;
  } finally {
    client.release();
  }
}

export function uniqueViolationOn(error: unknown, constraint: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const record = error as { code?: unknown; constraint?: unknown };
  return record.code === '23505' && record.constraint === constraint;
}
