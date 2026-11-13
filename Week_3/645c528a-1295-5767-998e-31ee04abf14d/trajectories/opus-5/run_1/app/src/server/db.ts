import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from './config.js';
import { ApiError } from './errors.js';

const here = dirname(fileURLToPath(import.meta.url));

export type Row = object;

export interface Queryable {
  query<T extends Row = Row>(text: string, values?: unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 30000,
  allowExitOnIdle: false,
});
pool.on('error', () => undefined);

function wrap(error: unknown): never {
  if (error instanceof ApiError) throw error;
  throw ApiError.storeUnavailable();
}

export async function query<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T[]> {
  try {
    const result = await pool.query(text, values);
    return result.rows as T[];
  } catch (error) {
    return wrap(error);
  }
}

export const direct: Queryable = {
  query: async <T extends Row = Row>(text: string, values: unknown[] = []) => {
    const rows = await query<T>(text, values);
    return { rows, rowCount: rows.length };
  },
};

export async function queryOne<T extends Row = Row>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    return wrap(error);
  }
  try {
    await client.query('BEGIN');
    const wrapped: Queryable = {
      query: async <R extends Row = Row>(text: string, values: unknown[] = []) => {
        const result = await client.query(text, values);
        return { rows: result.rows as R[], rowCount: result.rowCount ?? result.rows.length };
      },
    };
    const value = await work(wrapped);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      throw ApiError.storeUnavailable();
    }
    if (error instanceof ApiError) throw error;
    if (isDatabaseError(error)) throw error;
    return wrap(error);
  } finally {
    client.release();
  }
}

export function isDatabaseError(error: unknown): error is Error & { code: string } {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return typeof code === 'string' && /^\d/.test(code);
}

export async function applySchema(): Promise<void> {
  const candidates = [join(here, 'schema.sql'), join(here, '..', 'src', 'server', 'schema.sql')];
  let sql = '';
  for (const candidate of candidates) {
    try {
      sql = await readFile(candidate, 'utf8');
      break;
    } catch {
      sql = '';
    }
  }
  if (!sql) throw new Error('schema.sql not found');
  await query(sql);
}

export async function pingStore(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
