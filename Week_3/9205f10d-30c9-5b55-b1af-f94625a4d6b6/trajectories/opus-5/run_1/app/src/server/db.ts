import pg from 'pg';
import { env } from './env.js';

export type QueryValue = string | number | boolean | Date | null | string[];

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, values?: QueryValue[]): Promise<pg.QueryResult<Row>>;
}

// Numeric columns arrive as strings so that money never passes through a float.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: env.databaseUrl, max: 10 });

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  values: QueryValue[] = [],
): Promise<pg.QueryResult<Row>> {
  return pool.query<Row>(text, values);
}

export const db: Queryable = { query };

export async function transact<Result>(run: (client: Queryable) => Promise<Result>): Promise<Result> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
