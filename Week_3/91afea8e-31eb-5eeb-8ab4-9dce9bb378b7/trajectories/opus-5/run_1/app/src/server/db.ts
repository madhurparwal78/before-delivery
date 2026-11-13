import pg from 'pg';
import { config } from './config.js';

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(text, params as unknown[]);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export type Tx = {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T | null>;
};

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    async query<R extends Row = Row>(text: string, params: readonly unknown[] = []) {
      const result = await client.query(text, params as unknown[]);
      return result.rows as R[];
    },
    async one<R extends Row = Row>(text: string, params: readonly unknown[] = []) {
      const rows = await tx.query<R>(text, params);
      return rows.length > 0 ? rows[0] : null;
    },
  };
  try {
    await client.query('BEGIN');
    const value = await run(tx);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `job` only on the instance that holds the advisory lock, so shared work happens once. */
export async function withAdvisoryLock(key: number, job: () => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    const locked = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!locked.rows[0].locked) return;
    try {
      await job();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}
