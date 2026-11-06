import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

pool.on('error', () => {
  // A broken idle connection is dropped from the pool; the next query reconnects.
});

export async function query<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(text, values);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
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

/** Serialises schema and seed application across instances sharing one database. */
export async function withStartupLock<T>(run: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [728411]);
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock($1)', [728411]).catch(() => undefined);
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function isDatabaseUp(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}

export type { PoolClient };
