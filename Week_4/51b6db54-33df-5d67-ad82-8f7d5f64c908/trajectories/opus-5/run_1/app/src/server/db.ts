import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';
import schemaSql from './schema.sql';

export class DatabaseUnavailable extends Error {}

const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', () => undefined);

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

function wrap(error: unknown): never {
  const code = (error as { code?: string }).code ?? '';
  const connectionProblem =
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '57P01' ||
    code === '57P03' ||
    code === '08006' ||
    code === '08003';
  if (connectionProblem) {
    ready = false;
    throw new DatabaseUnavailable(String(code));
  }
  throw error;
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(sql, params);
    return result.rows;
  } catch (error) {
    return wrap(error);
  }
}

export async function one<T extends QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function transact<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return wrap(error);
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      ready = false;
    }
    return wrap(error);
  } finally {
    client.release();
  }
}

export async function rows<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(sql, params);
  return result.rows;
}

export async function first<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const list = await rows<T>(client, sql, params);
  return list[0] ?? null;
}

/** The schema is applied on every start, and kept retrying while Postgres is away. */
export async function applySchema(): Promise<void> {
  await pool.query(schemaSql);
  ready = true;
}

export async function keepTryingSchema(): Promise<void> {
  for (;;) {
    try {
      await applySchema();
      return;
    } catch {
      ready = false;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function probe(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
