import { Pool, type PoolClient, types } from 'pg';

// Dates travel as YYYY-MM-DD strings, so no timezone shift can change a due date.
types.setTypeParser(types.builtins.DATE, (value: string) => value);

export interface Db {
  pool: Pool;
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
  withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T>;
}

export interface DbClient {
  query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]>;
}

export function createDb(databaseUrl: string): Db {
  const pool = new Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000 });
  return {
    pool,
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await pool.query<T>(text, params);
      return result.rows;
    },
    async withClient<T>(fn: (client: DbClient) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        return await fn(wrapClient(client));
      } finally {
        client.release();
      }
    },
  };
}

function wrapClient(client: PoolClient): DbClient {
  return {
    async query<T extends Record<string, unknown>>(text: string, params?: unknown[]): Promise<T[]> {
      const result = await client.query<T>(text, params);
      return result.rows;
    },
  };
}

/** Run fn inside a transaction on a dedicated client. */
export async function inTransaction<T>(db: Db, fn: (client: DbClient) => Promise<T>): Promise<T> {
  return db.withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const out = await fn(client);
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}
