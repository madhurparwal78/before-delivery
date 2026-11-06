import { createHash } from 'node:crypto';
import pg from 'pg';
import { config } from './config';

const { Pool } = pg;

/** Numerics arrive as strings so no amount passes through binary floating point. */
pg.types.setTypeParser(1700, (value) => value);
/** Dates arrive as the plain calendar day Postgres stores. */
pg.types.setTypeParser(1082, (value) => value);

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30_000,
  allowExitOnIdle: false,
});

export type QueryValue = string | number | boolean | null | Date | string[];

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: readonly QueryValue[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as QueryValue[]);
  return result.rows;
}

export async function queryOne<T extends pg.QueryResultRow>(
  text: string,
  values: readonly QueryValue[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export interface Tx {
  query<T extends pg.QueryResultRow>(text: string, values?: readonly QueryValue[]): Promise<T[]>;
  queryOne<T extends pg.QueryResultRow>(
    text: string,
    values?: readonly QueryValue[],
  ): Promise<T | null>;
  /** Takes hold of a named subject for the rest of this transaction, across every process. */
  lock(subject: string): Promise<void>;
}

export async function withTransaction<T>(run: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    async query<R extends pg.QueryResultRow>(text: string, values: readonly QueryValue[] = []) {
      const result = await client.query<R>(text, values as QueryValue[]);
      return result.rows;
    },
    async queryOne<R extends pg.QueryResultRow>(text: string, values: readonly QueryValue[] = []) {
      const rows = await tx.query<R>(text, values);
      return rows[0] ?? null;
    },
    async lock(subject: string) {
      await client.query('select pg_advisory_xact_lock($1)', [lockKey(subject)]);
    },
  };
  let broken = false;
  try {
    await client.query('begin');
    const outcome = await run(tx);
    await client.query('commit');
    return outcome;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    client.release(broken);
  }
}

function lockKey(subject: string): string {
  const digest = createHash('sha256').update(subject).digest();
  const value = digest.readBigInt64BE(0);
  return value.toString();
}
