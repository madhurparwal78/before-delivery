import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';

// Date columns arrive as their ISO date string; Lineboard works in kitchen-local dates.
types.setTypeParser(1082, (value: string) => value);
import type { Config } from './config.js';

let pool: Pool;

export function initDb(config: Config): Pool {
  pool = new Pool({ connectionString: config.databaseUrl, max: 20 });
  return pool;
}

export function getPool(): Pool {
  return pool;
}

export async function query<T extends QueryResultRow = QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params);
  return result.rows as T[];
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* connection already gone */
    }
    throw err;
  } finally {
    client.release();
  }
}

const RETRYABLE = ['40001', '40P01', '55P03'];

/**
 * Run a transaction retrying serialisation failures and deadlocks, so no
 * request answers 5xx because of contention on the hour bank.
 */
export async function withContentionRetry<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await withTransaction(fn);
    } catch (err) {
      const code = (err as { code?: string }).code;
      if (attempt < 40 && code && RETRYABLE.includes(code)) continue;
      throw err;
    }
  }
}
