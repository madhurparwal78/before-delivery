import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

// Postgres `date` columns are the shop's Brussels dates and travel as YYYY-MM-DD strings.
pg.types.setTypeParser(1082, (v: string) => v);

export type Pool = pg.Pool;
export type Client = pg.PoolClient;

export async function createPool(databaseUrl: string): Promise<Pool> {
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
  await pool.query('SELECT 1');
  return pool;
}

/** Apply the schema idempotently, retrying while Postgres comes up (up to 60s). */
export async function applySchema(pool: Pool): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query(SCHEMA_SQL);
      return;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}

/** Run fn inside a transaction; rolls back on any throw. */
export async function withTransaction<T>(pool: Pool, fn: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Advisory-lock helper so two concurrent starts of one record produce one row. */
export async function withAdvisoryLock<T>(client: Client, key: string, fn: () => Promise<T>): Promise<T> {
  const { rows } = await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [key]);
  void rows;
  return fn();
}
