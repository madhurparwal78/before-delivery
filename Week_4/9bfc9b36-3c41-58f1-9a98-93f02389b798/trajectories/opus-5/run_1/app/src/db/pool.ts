import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from '../config';

/** Postgres is the system of record. Nothing caller-dependent lives in memory. */

export class DatabaseUnreachable extends Error {
  constructor(cause: string) {
    super(`The loft records did not answer: ${cause}`);
    this.name = 'DatabaseUnreachable';
  }
}

const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  // A broken idle connection is dropped from the pool; the next call reconnects.
});

function unreachable(cause: unknown): boolean {
  const code = (cause as { code?: string }).code;
  if (code === undefined) return true;
  // 08xxx connection exceptions, 57P01/57P03 shutdown and 53300 too many clients
  return code.startsWith('08') || code === '57P01' || code === '57P03' || code === '53300' || code === '3D000';
}

export async function query<R extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  try {
    const result = await pool.query<R>(text, values as unknown[]);
    return result.rows;
  } catch (cause) {
    if (unreachable(cause)) throw new DatabaseUnreachable(String((cause as Error).message));
    throw cause;
  }
}

export async function queryOne<R extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> {
  const rows = await query<R>(text, values);
  return rows[0] ?? null;
}

export interface Transaction {
  query<R extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<R[]>;
  one<R extends QueryResultRow>(text: string, values?: readonly unknown[]): Promise<R | null>;
}

/** Runs a unit of work in one transaction, so a change and its audit row share it. */
export async function transact<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    throw new DatabaseUnreachable(String((cause as Error).message));
  }
  const tx: Transaction = {
    async query<R extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<R[]> {
      const result = await client.query<R>(text, values as unknown[]);
      return result.rows;
    },
    async one<R extends QueryResultRow>(text: string, values: readonly unknown[] = []): Promise<R | null> {
      const rows = await tx.query<R>(text, values);
      return rows[0] ?? null;
    },
  };
  try {
    await client.query('BEGIN');
    const outcome = await work(tx);
    await client.query('COMMIT');
    return outcome;
  } catch (cause) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // the connection is gone; releasing it below removes it from the pool
    }
    if (unreachable(cause)) throw new DatabaseUnreachable(String((cause as Error).message));
    throw cause;
  } finally {
    client.release();
  }
}

/** Holds a database-wide lock for the length of the work. */
export async function withAdvisoryLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  let client: PoolClient;
  try {
    client = await pool.connect();
  } catch (cause) {
    throw new DatabaseUnreachable(String((cause as Error).message));
  }
  try {
    await client.query('SELECT pg_advisory_lock(hashtext($1))', [name]);
    return await work();
  } finally {
    try {
      await client.query('SELECT pg_advisory_unlock(hashtext($1))', [name]);
    } catch {
      // the lock goes when the connection does
    }
    client.release();
  }
}

export async function probeDatabase(): Promise<void> {
  await query('SELECT 1');
}
