import { setTimeout as sleep } from 'node:timers/promises';
import { config } from './config';
import { schemaSql } from './schema';
import { seedDatabase } from './seed';
import { DatabaseError, Pool, type Queryable } from './postgres';

export type Db = Queryable;

const pool = new Pool(config.databaseUrl, 20);

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

const RETRY_INTERVAL_MS = 2000;
const BOOT_LOCK = 734_002_611;

// Create the schema and seed once, serialised across every instance by a session-level advisory lock.
async function prepare(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [BOOT_LOCK]);
    try {
      await client.query(schemaSql);
      await client.query('BEGIN');
      await seedDatabase(client);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [BOOT_LOCK]);
    }
  } finally {
    client.release();
  }
}

// Keeps trying until PostgreSQL accepts the schema and seed; the server answers 503 meanwhile.
export async function connectWhenReachable(): Promise<void> {
  while (!ready) {
    try {
      await prepare();
      ready = true;
    } catch (error) {
      console.error('database not ready:', error instanceof Error ? error.message : String(error));
      await sleep(RETRY_INTERVAL_MS);
    }
  }
}

// Reads outside a transaction go straight to the pool.
export const db: Db = pool;

const RETRYABLE = new Set(['40P01', '40001']);

function sqlState(error: unknown): string | undefined {
  return error instanceof DatabaseError ? error.code : undefined;
}

// Runs fn in one transaction. A thrown refusal rolls it back; a deadlock or serialisation conflict
// is retried inside the request.
export async function transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T> {
  for (;;) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      if (!RETRYABLE.has(sqlState(error) ?? '')) throw error;
    } finally {
      client.release();
    }
  }
}
