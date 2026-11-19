import { Pool, type QueryResultRow } from 'pg';
import { config } from '../config';
import { SCHEMA } from './schema';

const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values as unknown[]);
  return result.rows;
}

export async function one<Row extends QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, values);
  return rows.length === 0 ? null : (rows[0] as Row);
}

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(734201)');
    await client.query(SCHEMA);
  } finally {
    await client.query('select pg_advisory_unlock(734201)');
    client.release();
  }
}

export async function withSeedLock<Value>(run: () => Promise<Value>): Promise<Value> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock(734202)');
    return await run();
  } finally {
    await client.query('select pg_advisory_unlock(734202)');
    client.release();
  }
}
