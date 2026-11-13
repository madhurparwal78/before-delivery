import pg from 'pg';
import { loadConfig } from './config';

const pool = new pg.Pool({
  connectionString: loadConfig().databaseUrl,
  application_name: 'hushline',
  max: 6,
  idleTimeoutMillis: 30_000,
});

export interface QueryResult<T> {
  rows: T[];
  rowCount: number | null;
}

export async function query<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<QueryResult<T>> {
  return pool.query<T>(text, params as never[]);
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}

export function nowSql(): string {
  return 'now()';
}
