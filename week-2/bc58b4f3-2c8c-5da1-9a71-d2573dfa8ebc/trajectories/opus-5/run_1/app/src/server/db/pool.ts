import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// Keep int8 (sequence values, counts) as JS numbers; all values here are far below 2^53.
types.setTypeParser(20, (value) => Number(value));
// Keep `date` columns as the plain YYYY-MM-DD text they are, free of any local-zone shift.
types.setTypeParser(1082, (value) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export type QueryValue = string | number | boolean | null | Date | Buffer | string[];

export interface Queryable {
  query<Row extends pg.QueryResultRow>(text: string, values?: QueryValue[]): Promise<pg.QueryResult<Row>>;
}

export async function withTransaction<T>(run: (tx: Queryable) => Promise<T>): Promise<T> {
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
