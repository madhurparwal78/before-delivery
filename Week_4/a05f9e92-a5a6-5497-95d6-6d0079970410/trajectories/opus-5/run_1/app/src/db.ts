/**
 * The Postgres pool. The schema is applied idempotently on every serve and the
 * server waits for the database at boot, answering `starting` until it connects.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

import { connections } from './config';
import { loadOffset } from './clock';

export const pool = new Pool({ connectionString: connections.databaseUrl, max: 12 });

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

export async function query<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function one<T extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

/** Runs a unit of work in one transaction, so a refused save changes nothing. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await work(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }
}

function schemaPath(): string {
  return resolve(__dirname, 'sql/schema.sql');
}

export async function applySchema(): Promise<void> {
  await pool.query(readFileSync(schemaPath(), 'utf8'));
}

/** Keeps retrying every 2 seconds until Postgres answers. */
export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}

export async function markReady(): Promise<void> {
  ready = true;
}

export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

/** The server clock offset lives in Postgres so it survives a restart. */
export async function loadClockOffset(): Promise<void> {
  const row = await one<{ value: unknown }>(`SELECT value FROM app_state WHERE key = 'clock_offset_ms'`);
  const value = row?.value;
  if (typeof value === 'number') loadOffset(value);
}

export async function saveClockOffset(ms: number): Promise<void> {
  await query(
    `INSERT INTO app_state (key, value) VALUES ('clock_offset_ms', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $1::jsonb`,
    [JSON.stringify(ms)],
  );
}

export async function readState<T>(key: string): Promise<T | null> {
  const row = await one<{ value: T }>(`SELECT value FROM app_state WHERE key = $1`, [key]);
  return row ? row.value : null;
}

export async function writeState(key: string, value: unknown): Promise<void> {
  await query(
    `INSERT INTO app_state (key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = $2::jsonb`,
    [key, JSON.stringify(value)],
  );
}

/** The next number in a published sequence, taken inside the caller's transaction. */
export async function nextNumber(client: PoolClient, prefix: string): Promise<string> {
  const result = await client.query<{ next_value: string }>(
    `INSERT INTO sequence_counter (prefix, next_value) VALUES ($1, 2)
     ON CONFLICT (prefix) DO UPDATE SET next_value = sequence_counter.next_value + 1
     RETURNING next_value`,
    [prefix],
  );
  const after = Number(result.rows[0].next_value);
  return `${prefix}${String(after - 1).padStart(6, '0')}`;
}

export async function peekNextNumber(prefix: string): Promise<string> {
  const row = await one<{ next_value: string }>(
    `SELECT next_value FROM sequence_counter WHERE prefix = $1`,
    [prefix],
  );
  const next = row ? Number(row.next_value) : 1;
  return `${prefix}${String(next).padStart(6, '0')}`;
}

export async function setSequence(prefix: string, next: number): Promise<void> {
  await query(
    `INSERT INTO sequence_counter (prefix, next_value) VALUES ($1, $2)
     ON CONFLICT (prefix) DO UPDATE SET next_value = $2`,
    [prefix, next],
  );
}

export type { PoolClient };
