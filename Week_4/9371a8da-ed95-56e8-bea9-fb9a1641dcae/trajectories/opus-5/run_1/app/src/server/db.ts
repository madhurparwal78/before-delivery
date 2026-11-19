import pg from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  /* a broken idle connection is dropped; the next call opens a fresh one */
});

export type Row = object;

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

export interface Tx {
  query<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T[]>;
  one<T extends Row = Row>(text: string, params?: readonly unknown[]): Promise<T | null>;
  lockProject(projectId: string): Promise<void>;
}

export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const tx: Tx = {
      async query<R extends Row = Row>(text: string, params: readonly unknown[] = []) {
        const result = await client.query(text, params as unknown[]);
        return result.rows as R[];
      },
      async one<R extends Row = Row>(text: string, params: readonly unknown[] = []) {
        const rows = await tx.query<R>(text, params);
        return rows.length > 0 ? rows[0] : null;
      },
      async lockProject(projectId: string) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`project:${projectId}`]);
      },
    };
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
