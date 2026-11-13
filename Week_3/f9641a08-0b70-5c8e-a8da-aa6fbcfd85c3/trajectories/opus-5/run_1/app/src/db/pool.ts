import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export type Db = {
  query<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow = QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
};

function wrap(runner: Pool | PoolClient): Db {
  return {
    async query<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await runner.query<T>(sql, params as never[]);
      return result.rows;
    },
    async one<T extends QueryResultRow = QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
      const result = await runner.query<T>(sql, params as never[]);
      return result.rows.length > 0 ? result.rows[0] : null;
    }
  };
}

export const db: Db = wrap(pool);

export async function tx<T>(run: (client: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const value = await run(wrap(client));
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown = null;
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error(`PostgreSQL unreachable: ${String(lastError)}`);
}

export async function applySchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(728411)');
    await client.query(sql);
  } finally {
    await client.query('SELECT pg_advisory_unlock(728411)');
    client.release();
  }
}

export async function withSetupLock<T>(run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(728412)');
    return await run();
  } finally {
    await client.query('SELECT pg_advisory_unlock(728412)');
    client.release();
  }
}

export async function nextCounter(client: Db, name: string, start: number): Promise<number> {
  const row = await client.one<{ value: string }>(
    `INSERT INTO counters (name, value) VALUES ($1, $2)
     ON CONFLICT (name) DO UPDATE SET value = counters.value + 1
     RETURNING value`,
    [name, start]
  );
  return Number(row!.value);
}
