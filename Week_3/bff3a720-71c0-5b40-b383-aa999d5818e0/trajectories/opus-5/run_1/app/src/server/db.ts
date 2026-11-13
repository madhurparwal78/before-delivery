import pg from 'pg';
import { config } from './config.js';
import { SCHEMA_SQL } from './schema.js';

const { Pool, types } = pg;

// Keep money and seat columns as JavaScript numbers; every amount is integer cents.
types.setTypeParser(20, (value: string) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 16 });

export type Row = object;

export interface Queryable {
  query<T extends Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export const db: Queryable = {
  query: (text, values) => pool.query(text, values as unknown[]),
};

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run({
      query: (text, values) => client.query(text, values as unknown[]) as never,
    });
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('PostgreSQL is not reachable');
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
