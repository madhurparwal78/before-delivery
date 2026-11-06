import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';

/** Keep `date` columns as the plain `YYYY-MM-DD` text they are, with no time-zone guesswork. */
types.setTypeParser(types.builtins.DATE, (value) => value);
types.setTypeParser(types.builtins.INT8, (value) => Number.parseInt(value, 10));

export type Db = Pool | PoolClient;

export interface Database {
  query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
  transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface Transaction {
  query<T extends QueryResultRow>(sql: string, params?: readonly unknown[]): Promise<T[]>;
}

export function createDatabase(connectionString: string): Database {
  const pool = new Pool({ connectionString, max: 16 });
  return {
    async query<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []) {
      const result = await pool.query<T>(sql, params as unknown[]);
      return result.rows;
    },
    async transaction<T>(run: (tx: Transaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const tx: Transaction = {
          async query<R extends QueryResultRow>(sql: string, params: readonly unknown[] = []) {
            const result = await client.query<R>(sql, params as unknown[]);
            return result.rows;
          },
        };
        const value = await run(tx);
        await client.query('commit');
        return value;
      } catch (error) {
        await client.query('rollback').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}

export async function waitForDatabase(database: Database): Promise<void> {
  for (;;) {
    try {
      await database.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}
