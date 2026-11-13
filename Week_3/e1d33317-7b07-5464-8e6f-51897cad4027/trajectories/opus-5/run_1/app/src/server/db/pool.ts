import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config.js';
import { ApiError, errors } from '../errors.js';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  // A dropped idle connection is replaced on the next query.
});

function translate(cause: unknown): never {
  if (cause instanceof ApiError) throw cause;
  throw errors.databaseUnavailable();
}

export async function query<T extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(sql, values as unknown[]);
    return result.rows;
  } catch (cause) {
    translate(cause);
  }
}

export async function one<T extends QueryResultRow>(
  sql: string,
  values: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(sql, values);
  return rows[0];
}

export async function transact<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch {
    throw errors.databaseUnavailable();
  }
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (cause) {
    await client.query('rollback').catch(() => undefined);
    translate(cause);
  } finally {
    client.release();
  }
}

export async function ping(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
