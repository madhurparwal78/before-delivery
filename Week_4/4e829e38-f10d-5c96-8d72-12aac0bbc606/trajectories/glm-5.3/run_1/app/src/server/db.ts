import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL || '', max: 12 });

export function db(): Pool { return pool; }

export async function query<T extends QueryResultRow = QueryResultRow>(text: string, params?: unknown[]): Promise<QueryResult<T>> {
  return pool.query(text, params as never[]) as Promise<QueryResult<T>>;
}
export async function withTx<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* already rolled back */ }
    throw e;
  } finally {
    client.release();
  }
}
