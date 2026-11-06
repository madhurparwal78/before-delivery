import pg from 'pg';
import { config } from '../config.js';

export type Queryable = {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<T>>;
};

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 24,
  idleTimeoutMillis: 30000,
});

pool.on('error', () => {
  // A broken idle client is replaced by the pool; nothing else to decide here.
});

export function db(): Queryable {
  return pool;
}

const retryableCodes = new Set(['40001', '40P01']);

/**
 * Runs a serialisable-safe transaction, retrying deadlocks and serialisation
 * failures inside the request so contention never produces a 5xx.
 */
export async function transact<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('begin');
      const result = await work(client);
      await client.query('commit');
      return result;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      const code = (error as { code?: string }).code;
      if (code !== undefined && retryableCodes.has(code) && attempt < 10) {
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
        continue;
      }
      throw error;
    } finally {
      client.release();
    }
  }
}

/** Lock classes for the one-at-a-time rules settled in PostgreSQL. */
export const LockClass = {
  station: 1,
  memberMonthHours: 2,
  booking: 3,
  monthClose: 4,
  kitchenRules: 5,
  memberDocumentType: 6,
  inspectorLink: 7,
  signinEmail: 8,
  idempotency: 9,
} as const;

export type LockClassName = keyof typeof LockClass;

export async function lock(client: Queryable, name: LockClassName, key: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [LockClass[name], key]);
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
