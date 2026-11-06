import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from '../config';

let pool: Pool | null = null;

export function database(): Pool {
  if (pool === null) {
    pool = new Pool({ connectionString: config().databaseUrl, max: 12 });
    pool.on('error', () => undefined);
  }
  return pool;
}

export async function query<R extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R[]> {
  const result = await database().query<R>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<R extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<R | null> {
  const rows = await query<R>(text, values);
  return rows.length === 0 ? null : rows[0];
}

export async function inTransaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await database().connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      await query('SELECT 1');
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error('PostgreSQL did not become reachable');
}
