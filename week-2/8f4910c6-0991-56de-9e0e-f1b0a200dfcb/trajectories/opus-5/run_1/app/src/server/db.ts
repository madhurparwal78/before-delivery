import pg from 'pg';
import { config } from './config.js';

// Numeric and bigint columns are read as strings by default; integer cents and
// counts are small enough to be parsed as numbers.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends Row = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export type Tx = {
  query<T extends Row = Row>(text: string, params?: unknown[]): Promise<T[]>;
  queryOne<T extends Row = Row>(text: string, params?: unknown[]): Promise<T | null>;
};

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    async query<R extends Row = Row>(text: string, params: unknown[] = []): Promise<R[]> {
      const result = await client.query<R>(text, params);
      return result.rows;
    },
    async queryOne<R extends Row = Row>(text: string, params: unknown[] = []): Promise<R | null> {
      const rows = await tx.query<R>(text, params);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('BEGIN');
    const value = await run(tx);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Runs `work` only in the copy that holds the advisory lock; others skip. */
export async function withAdvisoryLock(key: number, work: () => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    const locked = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock($1) AS locked', [key]);
    if (!locked.rows[0]?.locked) return;
    try {
      await work();
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
