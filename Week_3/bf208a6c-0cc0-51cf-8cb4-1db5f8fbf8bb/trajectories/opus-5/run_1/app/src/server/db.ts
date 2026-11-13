import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool, type PoolClient } from 'pg';
import { env } from './env';

export const pool = new Pool({ connectionString: env.databaseUrl, max: 20 });

export type Db = Pool | PoolClient;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export const waitForDatabase = async (): Promise<void> => {
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch {
      await sleep(1000);
    }
  }
};

export const applySchema = async (): Promise<void> => {
  const sql = readFileSync(join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
};

export const inTransaction = async <T>(work: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await work(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
};
