import pg from 'pg';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

// Money and counts are whole numbers well inside the safe integer range.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      client.release();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
