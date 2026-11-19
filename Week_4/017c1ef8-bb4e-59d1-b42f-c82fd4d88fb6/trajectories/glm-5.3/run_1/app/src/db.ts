import { Pool, PoolClient as PgPoolClient, QueryResult, QueryResultRow } from 'pg';

export type PoolClient = PgPoolClient;

let pool: Pool;

export const initDb = (url: string): void => {
  pool = new Pool({ connectionString: url, max: 10 });
  pool.on('error', () => { /* pool logs; keep serving */ });
};

export const query = async <T extends QueryResultRow = QueryResultRow>(
  text: string,
  params: readonly unknown[] = [],
): Promise<QueryResult<T>> => {
  if (!pool) throw new Error('Database not initialised');
  return pool.query<T>(text, params as unknown[]);
};

export const withTransaction = async <T>(fn: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* connection gone */ }
    throw e;
  } finally {
    client.release();
  }
};
