import pg from 'pg';
import type { PoolClient } from 'pg';

// bigint (int8) arrives as string by default; our counters stay far below 2^53.
pg.types.setTypeParser(20, (value: string) => Number(value));
pg.types.setTypeParser(21, (value: string) => Number(value));
pg.types.setTypeParser(23, (value: string) => Number(value));

export type Db = pg.Pool;
export type Tx = PoolClient;

export interface DbConfig {
  url: string;
  max?: number;
}

export function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 20, idleTimeoutMillis: 30000 });
  return pool;
}

export async function withTransaction<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let released = false;
  try {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      released = true;
      return result;
    } catch (e) {
      if (!released) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // connection likely broken
        }
      }
      throw e;
    }
  } finally {
    client.release();
  }
}
