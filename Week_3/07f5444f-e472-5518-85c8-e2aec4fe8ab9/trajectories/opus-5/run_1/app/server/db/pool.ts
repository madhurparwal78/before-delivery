import pg from 'pg';
import { config } from '../config.js';

export type QueryParam = string | number | boolean | Date | null | string[];

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, params?: QueryParam[]): Promise<pg.QueryResult<Row>>;
}

pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  /* a broken idle connection is dropped from the pool and retried on the next query */
});

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
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
