import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';
import { ApiError, errors } from '../errors.js';

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', () => {
  reachable = false;
});

let reachable = false;

export function postgresUp(): boolean {
  return reachable;
}

function asApiError(error: unknown): ApiError {
  if (error instanceof ApiError) return error;
  reachable = false;
  return errors.databaseUnavailable();
}

export async function query<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  try {
    const result = await pool.query<T>(sql, params as unknown[]);
    reachable = true;
    return result.rows;
  } catch (error) {
    throw asApiError(error);
  }
}

export async function one<T extends QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function tx<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
    reachable = true;
  } catch (error) {
    throw asApiError(error);
  }
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      reachable = false;
    }
    throw asApiError(error);
  } finally {
    client.release();
  }
}

export async function rows<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function rowOne<T extends QueryResultRow>(
  client: PoolClient,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const result = await rows<T>(client, sql, params);
  return result[0] ?? null;
}

export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}

export async function pingPostgres(): Promise<void> {
  try {
    await pool.query('select 1');
    reachable = true;
  } catch {
    reachable = false;
  }
}
