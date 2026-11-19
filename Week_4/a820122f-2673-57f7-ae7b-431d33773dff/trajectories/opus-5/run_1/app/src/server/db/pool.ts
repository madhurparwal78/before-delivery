import pg from 'pg';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

pg.types.setTypeParser(1082, (value: string) => value); // date stays a YYYY-MM-DD string
pg.types.setTypeParser(1700, (value: string) => Number(value)); // numeric as a number

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

export async function query<Row extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values as unknown[]);
  return result.rows;
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
