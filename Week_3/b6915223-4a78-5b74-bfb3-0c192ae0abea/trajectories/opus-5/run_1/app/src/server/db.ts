import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg';
import { config } from './config.ts';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export interface Queryable {
  query<T extends QueryResultRow>(text: string, values?: unknown[]): Promise<QueryResult<T>>;
}

export const query = async <T extends QueryResultRow>(
  on: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> => (await on.query<T>(text, values as unknown[])).rows;

export const one = async <T extends QueryResultRow>(
  on: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | undefined> => (await query<T>(on, text, values))[0];

export const transaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};

/** Serialises a named critical section across every copy of the server. */
export const withAdvisoryLock = async <T>(key: string, work: () => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(hashtext($1))', [key]);
    return await work();
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [key]).catch(() => undefined);
    client.release();
  }
};

export const connectWithRetry = async (timeoutMs: number): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
};
