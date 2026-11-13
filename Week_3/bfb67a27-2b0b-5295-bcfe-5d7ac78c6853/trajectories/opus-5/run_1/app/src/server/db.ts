import pg from 'pg';
import { config } from './config.js';

const { Pool, types } = pg;

// Keep calendar dates as the YYYY-MM-DD strings the API speaks.
types.setTypeParser(1082, (value: string) => value);
// Keep bigint money columns as JS numbers; every amount here is well inside 2^53.
types.setTypeParser(20, (value: string) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 20 });

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function withTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(maxWaitMs: number): Promise<void> {
  const deadline = Date.now() + maxWaitMs;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}
