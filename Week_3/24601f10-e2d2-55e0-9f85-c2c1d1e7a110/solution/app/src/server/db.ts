import pg from 'pg';
import { config } from './config.js';
import { SCHEMA } from './schema.js';

// bigint columns hold epoch milliseconds, which fit a double exactly.
pg.types.setTypeParser(20, (value) => Number(value));

export type Client = pg.PoolClient;
export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', (error) => console.error('postgres pool error:', error.message));

let ready = false;
export const isReady = (): boolean => ready;

const SCHEMA_LOCK = 727001;

export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        try {
          await client.query(SCHEMA);
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
        }
      } finally {
        client.release();
      }
      ready = true;
      return;
    } catch (error) {
      console.error('postgres is not reachable yet:', error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function tx<T>(work: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
