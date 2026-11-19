import pg from 'pg';
import { config } from './config.js';
import { SCHEMA } from './schema/schema.js';
import type { Audience, LiveEvent } from './live.js';
import { publish } from './live.js';

pg.types.setTypeParser(20, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on('error', (error) => console.error('postgres pool error', error.message));

export type Db = pg.Pool | pg.PoolClient;

/** A transaction's client, with the callbacks that run only after the commit. */
export type Tx = pg.PoolClient & { afterCommit: Array<() => void | Promise<void>> };

/** Publishes the event once the transaction has committed. */
export function publishAfterCommit(tx: Tx, to: Audience, event: LiveEvent): void {
  tx.afterCommit.push(() => publish(to, event));
}

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx: Tx = Object.assign(await pool.connect(), { afterCommit: [] });
  let result: T;
  try {
    await tx.query('BEGIN');
    result = await work(tx);
    await tx.query('COMMIT');
  } catch (error) {
    await tx.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
  // The write is stored: a callback that fails must not undo or fail it.
  for (const callback of tx.afterCommit) {
    try {
      await callback();
    } catch (error) {
      console.error('after-commit callback failed', error);
    }
  }
  return result;
}

export async function rows<Row extends object = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row & pg.QueryResultRow>(sql, params)).rows;
}

export async function maybeRow<Row extends object = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<Row | undefined> {
  return (await rows<Row>(db, sql, params))[0];
}

export async function oneRow<Row extends object = Record<string, unknown>>(db: Db, sql: string, params: unknown[] = []): Promise<Row> {
  const row = await maybeRow<Row>(db, sql, params);
  if (!row) throw new Error(`query returned no row: ${sql.slice(0, 80)}`);
  return row;
}

/** Serialises writers of one key for the rest of the transaction. */
export async function lockKey(db: pg.PoolClient, key: string): Promise<void> {
  await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [key]);
}

export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7040001)');
    for (const statement of SCHEMA) await client.query(statement);
  } finally {
    await client.query('SELECT pg_advisory_unlock(7040001)').catch(() => undefined);
    client.release();
  }
}
