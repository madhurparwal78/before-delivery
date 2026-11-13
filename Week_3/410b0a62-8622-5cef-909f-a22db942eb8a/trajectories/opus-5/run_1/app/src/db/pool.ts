import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<Row extends pg.QueryResultRow>(
  client: Queryable,
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await client.query<Row>(text, values);
  return result.rows;
}

export async function transaction<Result>(
  run: (client: pg.PoolClient) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
