import pg from 'pg';

// bigint values arrive as JSON numbers, not strings.
pg.types.setTypeParser(20, (value: string): number => Number(value));

// Single pool per process. Pool and Client are the only store interfaces.
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export type QueryResult<T extends pg.QueryResultRow> = pg.QueryResult<T>;

export async function query<T extends pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values as never[]);
}

export async function withTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
