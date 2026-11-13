import pg from 'pg';
import { config } from '../config.js';
import { problem } from '../http/problem.js';

const { Pool, types } = pg;

// Numerics and bigints come back as the exact text the database holds.
types.setTypeParser(1700, (value) => value);
types.setTypeParser(20, (value) => value);
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  // A killed session is expected; the pool opens a fresh one on the next query.
});

const CONNECTION_CODES = new Set([
  '08000',
  '08003',
  '08006',
  '08001',
  '08004',
  '57P01',
  '57P02',
  '57P03',
  '53300',
  '53400',
  '55006',
  '40001',
  '40P01',
]);

export function isUnavailable(error: unknown): boolean {
  if (error instanceof AggregateError) return true;
  const candidate = error as { code?: string; message?: string };
  if (typeof candidate.code === 'string') {
    if (CONNECTION_CODES.has(candidate.code)) return true;
    if (['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'EPIPE', 'EAI_AGAIN'].includes(candidate.code)) return true;
  }
  const message = candidate.message ?? '';
  return (
    message.includes('Connection terminated') ||
    message.includes('timeout exceeded when trying to connect') ||
    message.includes('Client has encountered a connection error') ||
    message.includes('terminating connection')
  );
}

export function asDatabaseProblem(error: unknown): unknown {
  return isUnavailable(error) ? problem('database_unavailable') : error;
}

export type Row = Record<string, unknown>;

export interface Queryable {
  query(text: string, values?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number }>;
}

export async function query<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<T[]> {
  try {
    const result = await pool.query<T>(text, values as unknown[]);
    return result.rows;
  } catch (error) {
    throw asDatabaseProblem(error);
  }
}

export async function queryOne<T extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transact<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw asDatabaseProblem(error);
  }
  try {
    await client.query('BEGIN');
    const wrapped: Queryable = {
      query: async (text, values) => {
        const result = await client.query(text, (values ?? []) as unknown[]);
        return { rows: result.rows as Row[], rowCount: result.rowCount ?? 0 };
      },
    };
    const outcome = await work(wrapped);
    await client.query('COMMIT');
    return outcome;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // The session is already gone; the transaction is rolled back with it.
    }
    throw asDatabaseProblem(error);
  } finally {
    client.release();
  }
}
