import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { env } from './env.js';
import { ApiError } from './errors.js';
import { SCHEMA_SQL } from './schema.js';

export class DatabaseUnavailable extends Error {
  constructor() {
    super('DATABASE_UNAVAILABLE');
  }
}

const pool = new Pool({
  connectionString: env.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  schemaReady = false;
});

let schemaReady = false;

async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  await pool.query(SCHEMA_SQL);
  schemaReady = true;
}

function unavailable(error: unknown): never {
  schemaReady = false;
  const code = (error as { code?: string }).code;
  if (code !== undefined && /^(22|23|42)/.test(code)) throw error;
  throw new DatabaseUnavailable();
}

export async function query<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T[]> {
  try {
    await ensureSchema();
    const result = await pool.query<T>(sql, values);
    return result.rows;
  } catch (error) {
    return unavailable(error);
  }
}

export async function one<T extends QueryResultRow>(sql: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, values);
  return rows.length === 0 ? null : rows[0];
}

export async function transaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    await ensureSchema();
    client = await pool.connect();
  } catch (error) {
    return unavailable(error);
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
      schemaReady = false;
    }
    if (error instanceof ApiError) throw error;
    return unavailable(error);
  } finally {
    client.release();
  }
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await ensureSchema();
    await pool.query('select 1');
    return true;
  } catch {
    schemaReady = false;
    return false;
  }
}
