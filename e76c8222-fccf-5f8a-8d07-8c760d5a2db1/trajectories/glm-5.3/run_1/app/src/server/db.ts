import pg from 'pg';

export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export type Queryable = pg.PoolClient | pg.Pool;

export async function query<T extends pg.QueryResultRow>(
  q: Queryable, text: string, params: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return q.query<T>(text, params as unknown[]);
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}
