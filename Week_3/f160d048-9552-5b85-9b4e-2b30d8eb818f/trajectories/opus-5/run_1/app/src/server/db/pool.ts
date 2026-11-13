import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export interface Db {
  query<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null>;
}

function wrap(runner: Pool | PoolClient): Db {
  return {
    async query<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T[]> {
      const result = await runner.query<T>(sql, params);
      return result.rows;
    },
    async one<T extends QueryResultRow>(sql: string, params: unknown[] = []): Promise<T | null> {
      const result = await runner.query<T>(sql, params);
      return result.rows[0] ?? null;
    },
  };
}

export const db: Db = wrap(pool);

export async function transaction<T>(run: (tx: Db) => Promise<T>): Promise<T> {
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

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function applySchema(): Promise<void> {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await pool.query('INSERT INTO clock_offset (id, offset_seconds) VALUES (true, 0) ON CONFLICT (id) DO NOTHING');
}
