import pg from 'pg';
import { config } from './config.js';
import { ApiError } from './errors.js';

const { Pool } = pg;

// Timestamps and dates are handled as ISO strings by the domain code, so the
// driver must not turn them into local-zone Date objects.
const timestampPattern = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2}(?:\.\d+)?)([+-]\d{2})(?::?(\d{2}))?$/;

function isoTimestamp(value: string): string {
  const parts = timestampPattern.exec(value);
  if (parts === null) return value;
  return `${parts[1]}T${parts[2]}${parts[3]}:${parts[4] ?? '00'}`;
}

pg.types.setTypeParser(1114, (v) => v);
pg.types.setTypeParser(1184, isoTimestamp);
pg.types.setTypeParser(1082, (v) => v);
pg.types.setTypeParser(20, (v) => Number(v));

const unavailableCodes = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  'EPIPE',
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '53300',
  '57P01',
  '57P02',
  '57P03',
  '3D000',
]);

export function isUnavailable(error: unknown): boolean {
  if (error instanceof ApiError) return error.code === 'database_unavailable';
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && unavailableCodes.has(code)) return true;
  const message = (error as { message?: unknown }).message;
  return (
    typeof message === 'string' &&
    (message.includes('Connection terminated') ||
      message.includes('timeout exceeded when trying to connect') ||
      message.includes('Client has encountered a connection error') ||
      message.includes('server closed the connection'))
  );
}

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10000,
  application_name: 'tallyroom',
});

pool.on('error', () => {
  // An idle client dropped; the next query reconnects.
});


export type Row = Record<string, unknown>;

export type Queryable = {
  query<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  one<T extends Row = Row>(sql: string, params?: readonly unknown[]): Promise<T | undefined>;
};

function wrap(runner: (sql: string, params: readonly unknown[]) => Promise<pg.QueryResult>): Queryable {
  const query = async <T extends Row>(sql: string, params: readonly unknown[] = []): Promise<T[]> => {
    try {
      const result = await runner(sql, params);
      return result.rows as T[];
    } catch (error) {
      if (isUnavailable(error)) throw new ApiError('database_unavailable');
      throw error;
    }
  };
  return {
    query,
    async one<T extends Row>(sql: string, params: readonly unknown[] = []): Promise<T | undefined> {
      const rows = await query<T>(sql, params);
      return rows[0];
    },
  };
}

export const db: Queryable = wrap((sql, params) => pool.query(sql, params as unknown[]));

export async function tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isUnavailable(error)) throw new ApiError('database_unavailable');
    throw error;
  }
  const scoped = wrap((sql, params) => client.query(sql, params as unknown[]));
  try {
    await scoped.query('BEGIN');
    const result = await fn(scoped);
    await scoped.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The connection is already gone; releasing with an error discards it.
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await db.query('select 1');
    return true;
  } catch {
    return false;
  }
}
