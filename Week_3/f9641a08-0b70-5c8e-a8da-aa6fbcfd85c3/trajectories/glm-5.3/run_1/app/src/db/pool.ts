import pg from 'pg';
import { CONFIG } from '../config.js';

export type Client = pg.PoolClient;
export type { pg };

export const pool = new pg.Pool({
  connectionString: CONFIG.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
});

export async function withClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

export async function inTransaction<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* already aborted */ }
      throw err;
    }
  });
}

export async function withLockedVariants<T>(skus: string[], fn: (client: Client) => Promise<T>): Promise<T> {
  const sorted = [...new Set(skus)].sort();
  return inTransaction(async (client) => {
    if (sorted.length > 0) {
      await client.query(`SELECT sku FROM variants WHERE sku = ANY($1) ORDER BY sku FOR UPDATE`, [sorted]);
    }
    return fn(client);
  });
}
