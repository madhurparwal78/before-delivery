import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

let lastError: Error | null = null;
pool.on('error', (e) => { lastError = e; });

export async function db(): Promise<pg.PoolClient> {
  const client = await pool.connect();
  return client;
}

export async function withDb<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function dbUp(): Promise<boolean> {
  try {
    const c = await pool.connect();
    c.release();
    lastError = null;
    return true;
  } catch {
    return false;
  }
}

export function dbError(): Error | null { return lastError; }

export { pg };
