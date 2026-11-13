import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', () => {
  // A broken idle connection is dropped from the pool; the next query reconnects.
});

export async function query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(sql, params as never[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export interface Tx {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
}

export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  const tx: Tx = {
    async query<R extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
      const result = await client.query<R>(sql, params as never[]);
      return result.rows;
    },
    async queryOne<R extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<R | null> {
      const rows = await tx.query<R>(sql, params);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('begin');
    const value = await fn(tx);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
