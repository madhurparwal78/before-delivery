import { Pool, type PoolClient, types } from 'pg';
import { config } from './config.js';

// Dates and numerics arrive as strings so no amount or measurement meets a float.
types.setTypeParser(types.builtins.DATE, (value) => value);
types.setTypeParser(types.builtins.NUMERIC, (value) => value);
types.setTypeParser(types.builtins.INT8, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = object;

export async function query<T extends Row = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function queryOne<T extends Row = Record<string, unknown>>(
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows.length === 0 ? null : rows[0];
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function txRows<T extends Row = Record<string, unknown>>(
  client: PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(text, params as unknown[]);
  return result.rows;
}

export async function txRow<T extends Row = Record<string, unknown>>(
  client: PoolClient,
  text: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const found = await txRows<T>(client, text, params);
  return found.length === 0 ? null : found[0];
}

/** Serialises writers that contend for one domain record inside a transaction. */
export async function lockKey(client: PoolClient, ...parts: string[]): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [parts.join('|')]);
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (attempt >= 60) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export type { PoolClient };
