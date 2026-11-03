import pg from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export interface Tx {
  query<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<T[]>;
  queryOne<T extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<T | null>;
}

function wrap(client: PoolClient): Tx {
  return {
    async query<T extends QueryResultRow>(text: string, values: readonly unknown[] = []) {
      const result = await client.query<T>(text, values as unknown[]);
      return result.rows;
    },
    async queryOne<T extends QueryResultRow>(
      text: string,
      values: readonly unknown[] = [],
    ): Promise<T | null> {
      const result = await client.query<T>(text, values as unknown[]);
      return result.rows[0] ?? null;
    },
  };
}

/** Every rule the database decides runs inside one of these transactions. */
export async function transaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(wrap(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function ping(): Promise<void> {
  await pool.query('SELECT 1');
}

export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' && error !== null && 'code' in error && error.code === '23505'
  );
}
