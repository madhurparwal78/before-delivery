import pg from 'pg';
import { config } from '../config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Row = Record<string, unknown>;

export async function query<T extends Row = Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function one<T extends Row = Row>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

async function withAdvisoryLock<T>(first: number, second: number, work: () => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1, $2)', [first, second]);
    return await work();
  } finally {
    await client.query('select pg_advisory_unlock($1, $2)', [first, second]);
    client.release();
  }
}

/** Several copies starting together each apply their schema and seed once. */
export async function withStartLock<T>(work: () => Promise<T>): Promise<T> {
  return withAdvisoryLock(728411, 0, work);
}

/** Two bookings of one slot give exactly one winner. */
export async function withDeskLock<T>(deskId: string, work: () => Promise<T>): Promise<T> {
  let hash = 0;
  for (const character of deskId) hash = (hash * 31 + character.charCodeAt(0)) | 0;
  return withAdvisoryLock(728412, hash, work);
}
