// PostgreSQL access: one pool, parameterised queries, and transactions.
import pg from 'pg';
import { config } from './config.ts';

pg.types.setTypeParser(20, (v: string) => Number(v)); // bigint counts and event ids fit in a double
pg.types.setTypeParser(1082, (v: string) => v); // dates stay YYYY-MM-DD

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on('error', () => undefined);

export type Row = Record<string, unknown>;
export interface Db {
  query<T extends object = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}

export const db: Db = {
  async query<T extends object>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await pool.query(sql, params)).rows as T[];
  },
};

type AfterCommit = () => void | Promise<void>;
export interface Tx extends Db {
  afterCommit(fn: AfterCommit): void;
}

/** Runs `fn` in one transaction; post-commit callbacks run only after COMMIT succeeds. */
export async function transaction<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const after: AfterCommit[] = [];
  const tx: Tx = {
    async query<R extends object>(sql: string, params: unknown[] = []): Promise<R[]> {
      return (await client.query(sql, params)).rows as R[];
    },
    afterCommit(cb) {
      after.push(cb);
    },
  };
  let result: T;
  try {
    await client.query('BEGIN');
    result = await fn(tx);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    client.release();
    throw error;
  }
  client.release();
  // Committed: post-commit work runs on its own and never reaches the released client.
  for (const cb of after) await Promise.resolve().then(cb).catch(() => undefined);
  return result;
}

export async function one<T extends object>(q: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await q.query<T>(sql, params))[0];
}
