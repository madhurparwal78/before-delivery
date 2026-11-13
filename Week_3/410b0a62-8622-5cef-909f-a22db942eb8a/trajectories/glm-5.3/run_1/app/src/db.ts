import pg from 'pg';

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export type Queryable = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  q: Queryable,
  text: string,
  params: readonly unknown[] = []
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
    try {
      await client.query('ROLLBACK');
    } catch {
      // connection already broken; the original error is what matters
    }
    throw err;
  } finally {
    client.release();
  }
}

export async function connectDatabase(): Promise<void> {
  await pool.query('SELECT 1');
}

export { pool };
