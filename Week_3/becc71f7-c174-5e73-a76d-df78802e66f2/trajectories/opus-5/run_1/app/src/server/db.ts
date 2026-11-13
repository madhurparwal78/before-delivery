import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

const { Pool, types } = pg;

// Read timestamps and dates as plain text so instants stay whole-second UTC and Brussels
// dates never pass through the host's own time zone.
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);
types.setTypeParser(1082, (value) => value);
types.setTypeParser(20, (value) => Number(value));

export type Database = pg.Pool;
export type Row = Record<string, unknown>;

export interface Queryable {
  query<T extends Row = Row>(sql: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number | null }>;
}

const SCHEMA_LOCK = 8_421_773;

/** Waits up to 60 seconds for Postgres before giving up. */
export async function connect(databaseUrl: string): Promise<Database> {
  const deadline = Date.now() + 60_000;
  let lastError: unknown;
  for (;;) {
    const pool = new Pool({ connectionString: databaseUrl, max: 10 });
    try {
      await pool.query('SELECT 1');
      return pool;
    } catch (error) {
      await pool.end().catch(() => undefined);
      lastError = error;
      if (Date.now() >= deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Postgres is unreachable');
}

export async function applySchema(db: Database): Promise<void> {
  const client = await db.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
    await client.query(SCHEMA_SQL);
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}

/** Runs `work` inside one transaction, rolling back on any failure. */
export async function inTransaction<T>(db: Database, work: (tx: Queryable) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

/** Postgres timestamptz text to a UTC instant in milliseconds. */
export function instantOf(value: unknown): number {
  const text = String(value);
  return Date.parse(/[+-]\d{2}(:?\d{2})?$|Z$/.test(text) ? text : `${text}Z`);
}

export function maybeInstant(value: unknown): number | null {
  return value === null || value === undefined ? null : instantOf(value);
}

/** An instant as a Postgres parameter, cut to the whole second. */
export function instantParam(utcMs: number): string {
  return new Date(Math.floor(utcMs / 1000) * 1000).toISOString();
}
