import pg from 'pg';
import { config } from './config.js';

const POOL_SIZE = 10;

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  application_name: 'hushline',
  max: POOL_SIZE,
  idleTimeoutMillis: 10_000,
});

pool.on('error', () => undefined);

export type Db = pg.Pool | pg.PoolClient;

export async function withTransaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query('begin');
    const result = await work(tx);
    await tx.query('commit');
    return result;
  } catch (error) {
    await tx.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
