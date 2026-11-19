import pg, { type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function one<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function transact<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises work per key across every app instance for the length of the transaction. */
export async function lock(client: PoolClient, scope: string, key: string): Promise<void> {
  await client.query('select pg_advisory_xact_lock(hashtextextended($1 || $2, 0))', [`${scope}:`, key]);
}
