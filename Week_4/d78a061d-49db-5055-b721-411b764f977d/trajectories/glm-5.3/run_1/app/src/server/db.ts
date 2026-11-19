import pg from 'pg';
import config from './config.js';

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
});

// bigint arrives as a string; every count is sent as a JSON integer elsewhere.
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(21, (v) => parseInt(v, 10));
pg.types.setTypeParser(23, (v) => parseInt(v, 10));
pg.types.setTypeParser(700, (v) => parseFloat(v));
pg.types.setTypeParser(701, (v) => parseFloat(v));
pg.types.setTypeParser(1700, (v) => parseFloat(v));

export interface QueryResult<Row> {
  rows: Row[];
  rowCount: number | null;
}

export async function query<Row = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<QueryResult<Row>> {
  return (await pool.query(text, params)) as unknown as QueryResult<Row>;
}

export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (err) {
    try { await client.query('rollback'); } catch { /* connection already broken */ }
    throw err;
  } finally {
    client.release();
  }
}

export type DBClient = pg.PoolClient;
