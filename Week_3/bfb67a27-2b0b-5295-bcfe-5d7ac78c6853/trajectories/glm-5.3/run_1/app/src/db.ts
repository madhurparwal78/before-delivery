import { Pool, type PoolClient } from 'pg';

// Postgres is the system of record; every read and write goes through this pool.

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let result: T;
  try {
    await client.query('BEGIN');
    result = await fn(client);
    await client.query('COMMIT');
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken; nothing to undo
    }
    client.release();
    throw error;
  }
  client.release();
  return result;
}
