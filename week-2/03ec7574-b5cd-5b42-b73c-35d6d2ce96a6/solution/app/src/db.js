import { config } from './config.js';
import { ApiError } from './lib/core.js';
import { ConnectionError, Pool } from './pg.js';

export const pool = new Pool(config.databaseUrl, { max: 20, connectTimeoutMs: 3000 });

// Set once the schema and the seed are in place; until then the API answers as unavailable.
export const state = { ready: false };

const RETRYABLE = new Set(['40001', '40P01']);
const OUTAGE_CODES = new Set(['57P01', '57P02', '57P03', '08000', '08001', '08003', '08004', '08006']);

export function isOutage(err) {
  return err instanceof ConnectionError || OUTAGE_CODES.has(err?.code);
}

export const unavailable = () => new ApiError(503, 'DATABASE_UNAVAILABLE',
  "Corvo can't reach its database. Nothing was changed. Try again in a moment.");

export function query(text, params = []) {
  return pool.query(text, params);
}

// Runs fn(client) inside one transaction; a deadlock or serialization failure is retried.
export async function tx(fn) {
  for (let attempt = 0; ; attempt += 1) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      client.release();
      return result;
    } catch (err) {
      const lost = err instanceof ConnectionError;
      if (!lost) await client.query('ROLLBACK').catch(() => {});
      client.release(lost);
      if (RETRYABLE.has(err.code) && attempt < 5) continue;
      throw err;
    }
  }
}
