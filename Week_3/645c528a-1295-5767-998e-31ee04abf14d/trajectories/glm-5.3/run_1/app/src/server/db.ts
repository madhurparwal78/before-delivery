import type { Pool, PoolClient } from 'pg';

export interface Db {
  pool: Pool;
  query: Pool['query'];
  tx: <T>(fn: (client: PoolClient) => Promise<T>) => Promise<T>;
}

export type { PoolClient };


export function createDb(pool: Pool): Db {
  return {
    pool,
    query: pool.query.bind(pool),
    tx: async (fn) => {
      const client = await pool.connect();
      let released = false;
      try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        if (!released) {
          try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
        }
        throw err;
      } finally {
        released = true;
        client.release();
      }
    },
  };
}
