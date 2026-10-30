import pg from 'pg';
import { config } from '../config.js';

// Every bigint this product stores (cents, ids, minutes) is far inside the
// safe-integer range, so read them as numbers instead of strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number.parseFloat(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export type QueryValue = string | number | boolean | Date | null | string[];

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  values: QueryValue[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function queryOne<Row extends pg.QueryResultRow>(
  text: string,
  values: QueryValue[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, values);
  return rows[0] ?? null;
}

export interface Transaction {
  query<Row extends pg.QueryResultRow>(text: string, values?: QueryValue[]): Promise<Row[]>;
  queryOne<Row extends pg.QueryResultRow>(text: string, values?: QueryValue[]): Promise<Row | null>;
}

export async function withTransaction<Result>(
  run: (tx: Transaction) => Promise<Result>,
): Promise<Result> {
  const client = await pool.connect();
  const tx: Transaction = {
    async query<Row extends pg.QueryResultRow>(text: string, values: QueryValue[] = []) {
      const result = await client.query<Row>(text, values);
      return result.rows;
    },
    async queryOne<Row extends pg.QueryResultRow>(text: string, values: QueryValue[] = []) {
      const result = await client.query<Row>(text, values);
      return result.rows[0] ?? null;
    },
  };
  try {
    await client.query('BEGIN');
    const result = await run(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
