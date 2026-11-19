import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = QueryResultRow;

export const query = async <T extends Row>(text: string, params: readonly unknown[] = []): Promise<T[]> => {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
};

export const queryOne = async <T extends Row>(text: string, params: readonly unknown[] = []): Promise<T | null> => {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
};

export interface Tx {
  query<T extends Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  queryOne<T extends Row>(text: string, params?: readonly unknown[]): Promise<T | null>;
}

const wrap = (client: PoolClient): Tx => ({
  async query<T extends Row>(text: string, params: readonly unknown[] = []) {
    const result = await client.query<T>(text, params as unknown[]);
    return result.rows;
  },
  async queryOne<T extends Row>(text: string, params: readonly unknown[] = []) {
    const result = await client.query<T>(text, params as unknown[]);
    return result.rows.length > 0 ? result.rows[0] : null;
  },
});

export const transaction = async <T>(work: (tx: Tx) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

export const waitForDatabase = async (): Promise<void> => {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
};

/** A Postgres advisory lock held for the length of one transaction. */
export const takeAdvisoryLock = async (tx: Tx, key: string): Promise<void> => {
  await tx.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
};

/** Tries for an advisory lock, returning false when another instance holds it. */
export const tryAdvisoryLock = async (tx: Tx, key: string): Promise<boolean> => {
  const row = await tx.queryOne<{ locked: boolean }>('SELECT pg_try_advisory_xact_lock(hashtext($1)) AS locked', [key]);
  return row !== null && row.locked;
};
