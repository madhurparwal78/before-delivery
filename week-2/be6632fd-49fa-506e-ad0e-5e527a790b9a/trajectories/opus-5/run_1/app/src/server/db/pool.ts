import pg from 'pg';
import { config } from '../config.ts';

// Instants travel as numbers of milliseconds; keep timestamptz out of the driver's Date parsing.
pg.types.setTypeParser(1184, (value: string) => value);
pg.types.setTypeParser(1114, (value: string) => value);
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(1700, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
});

export type Row = object;

export async function query<T extends Row = Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends Row = Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export interface Transaction {
  query<T extends Row = Row>(text: string, values?: readonly unknown[]): Promise<T[]>;
  queryOne<T extends Row = Row>(text: string, values?: readonly unknown[]): Promise<T | null>;
}

export async function transact<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Transaction = {
    async query<R extends Row = Row>(text: string, values: readonly unknown[] = []): Promise<R[]> {
      const result = await client.query<R>(text, values as unknown[]);
      return result.rows;
    },
    async queryOne<R extends Row = Row>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<R | null> {
      const rows = await tx.query<R>(text, values);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('begin');
    const value = await run(tx);
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
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

/** Runs `work` while holding a session-level advisory lock, so one copy at a time does it. */
export async function withAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [key]);
    return await work();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [key]).catch(() => undefined);
    client.release();
  }
}

/** Takes the lock only when it is free; returns null when another copy holds it. */
export async function tryAdvisoryLock<T>(key: number, work: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const taken = await client.query<{ pg_try_advisory_lock: boolean }>(
      'select pg_try_advisory_lock($1)',
      [key],
    );
    if (taken.rows[0]?.pg_try_advisory_lock !== true) return null;
    try {
      return await work();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [key]).catch(() => undefined);
    }
  } finally {
    client.release();
  }
}
