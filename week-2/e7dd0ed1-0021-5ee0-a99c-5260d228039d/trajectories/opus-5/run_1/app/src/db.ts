import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// Return bigint and numeric columns as strings so exact integer maths stays exact.
types.setTypeParser(20, (value: string) => value);
types.setTypeParser(1700, (value: string) => value);

export class DatabaseUnavailable extends Error {
  constructor(cause: unknown) {
    super('database unavailable');
    this.cause = cause;
  }
}

const pool = new Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 4000 });
pool.on('error', () => {
  /* a broken idle connection is dropped from the pool and retried on the next query */
});

function isConnectionFailure(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code && ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', 'ECONNRESET', '57P03', '08006', '08003', '08001'].includes(code)) return true;
  const message = (error as Error).message ?? '';
  return /timeout exceeded when trying to connect|Connection terminated|terminating connection/i.test(message);
}

export type Row = Record<string, string | null>;

export async function query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
  try {
    const result = await pool.query(sql, params);
    return result.rows as T[];
  } catch (error) {
    if (isConnectionFailure(error)) throw new DatabaseUnavailable(error);
    throw error;
  }
}

export async function one<T = Row>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    throw new DatabaseUnavailable(error);
  }
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is already gone; releasing it below removes it from the pool */
    }
    if (isConnectionFailure(error)) throw new DatabaseUnavailable(error);
    throw error;
  } finally {
    client.release();
  }
}

export async function rows<T = Row>(client: PoolClient, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

export async function row<T = Row>(client: PoolClient, sql: string, params: unknown[] = []): Promise<T | null> {
  const result = await rows<T>(client, sql, params);
  return result.length > 0 ? result[0] : null;
}

/** Serialises every change that must be decided one at a time, by name. */
export async function advisoryLock(client: PoolClient, name: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1, 0))', [name]);
}

export type { PoolClient };
