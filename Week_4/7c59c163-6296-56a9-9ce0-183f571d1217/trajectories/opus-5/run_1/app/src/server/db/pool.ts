import pg from 'pg';
import { config } from '../config.js';

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number.parseFloat(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 16 });

export type Db = pg.Pool | pg.PoolClient;

export async function inTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises concurrent work on one key (member, market) inside a transaction. */
export async function lockAdvisory(client: pg.PoolClient, namespace: number, key: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock($1, hashtext($2))', [namespace, key]);
}

export const LOCK_MARKET = 11;
export const LOCK_MEMBER = 12;
export const LOCK_SEED = 14;
