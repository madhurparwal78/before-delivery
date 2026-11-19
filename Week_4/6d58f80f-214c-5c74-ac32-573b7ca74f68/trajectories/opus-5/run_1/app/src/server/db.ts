import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { config } from './config.js';
import { SCHEMA_SQL } from './schema.js';

pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 3_000,
});

pool.on('error', (error) => {
  console.error('database pool error', error.message);
});

export type Row = object;

export interface Queryable {
  query<T extends Row = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export const db: Queryable = {
  query: (text, values) => pool.query(text, values) as never,
};

export const withTransaction = async <T>(work: (tx: Queryable) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work({ query: (text, values) => client.query(text, values) as never });
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

const ID_ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export const newId = (): string => {
  const bytes = randomBytes(16);
  let out = '';
  for (const byte of bytes) out += ID_ALPHABET[byte % ID_ALPHABET.length];
  return out;
};

/** Runs `work` while holding a database-wide advisory lock, so only one process does it. */
export const withAdvisoryLock = async <T>(key: number, work: () => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [key]);
    return await work();
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [key]);
    client.release();
  }
};

/** Serialises schema application and seeding so two instances never race each other. */
export const SETUP_LOCK = 528_614;

export const applySchema = async (): Promise<void> => {
  await withAdvisoryLock(SETUP_LOCK, async () => {
    await pool.query(SCHEMA_SQL);
  });
};

export const databaseReady = async (): Promise<boolean> => {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
};

