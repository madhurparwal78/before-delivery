// Database access: a single pool plus helpers. The server clock lives here.

import { webcrypto as crypto } from 'node:crypto';
import pg from 'pg';
import { Pool, PoolClient, QueryResult } from 'pg';

pg.types.setTypeParser(20, (v: string) => Number(v));   // int8
pg.types.setTypeParser(21, (v: string) => Number(v));  // int2
pg.types.setTypeParser(23, (v: string) => Number(v)); // int4
pg.types.setTypeParser(700, parseFloat);
pg.types.setTypeParser(701, parseFloat);

let pool: Pool | null = null;

export interface Db {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>>;
  withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T>;
  end(): Promise<void>;
}

export async function connect(url: string): Promise<Db> {
  pool = new Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
  });
  const q = async <T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<QueryResult<T>> => {
    if (!pool) throw new Error('Database pool is closed');
    return pool.query<T>(sql, params as unknown[]);
  };
  return {
    query: q,
    withTransaction: async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
      const client = await pool!.connect();
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    end: async () => {
      if (pool) await pool.end();
      pool = null;
    },
  };
}

/** The server clock: real time plus a grading offset, stored in Postgres. */
export class Clock {
  private offsetMs = 0;

  setOffset(offsetMs: number): void {
    this.offsetMs = offsetMs;
  }

  nowMs(): number {
    return Date.now() + this.offsetMs;
  }

  nowISO(): string {
    return new Date(this.nowMs()).toISOString();
  }
}

export const clock = new Clock();

export function randomBytes(count: number): string {
  const bytes = new Uint8Array(count);
  crypto.getRandomValues(bytes);
  return [...bytes].map(b => b.toString(16).padStart(2, '0')).join('');
}
