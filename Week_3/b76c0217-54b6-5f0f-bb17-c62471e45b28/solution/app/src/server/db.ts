import pg from 'pg';
import { config } from './config';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', () => undefined);

/** Anything that can run a query: the pool, or one client inside a transaction. */
export interface Db {
  query<Row>(sql: string, params?: unknown[]): Promise<Row[]>;
}

function camel(name: string): string {
  return name.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function rows<Row>(result: pg.QueryResult): Row[] {
  return result.rows.map((row: Record<string, unknown>) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [camel(key), value])),
  ) as Row[];
}

export const db: Db = {
  async query<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
    return rows<Row>(await pool.query(sql, params));
  },
};

export async function transaction<T>(work: (tx: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const tx: Db = {
    async query<Row>(sql: string, params: unknown[] = []): Promise<Row[]> {
      return rows<Row>(await client.query(sql, params));
    },
  };
  try {
    await client.query('begin');
    const result = await work(tx);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

/** A write that broke a unique constraint: the rule lives in the schema, this names the refusal. */
export const isUniqueViolation = (error: unknown): boolean => error instanceof pg.DatabaseError && error.code === '23505';

export async function one<Row>(source: Db, sql: string, params: unknown[] = []): Promise<Row | null> {
  const result = await source.query<Row>(sql, params);
  return result[0] ?? null;
}

/** Wait for Postgres for up to 60 seconds, then give up. */
export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}
