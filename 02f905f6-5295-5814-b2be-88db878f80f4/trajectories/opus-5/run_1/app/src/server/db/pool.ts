import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../env';

export const pool = new Pool({ connectionString: env.databaseUrl, max: 10 });

export async function query<Row extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  const result = await pool.query<Row>(text, values);
  return result.rows;
}

export async function queryOne<Row extends QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<Row | null> {
  const rows = await query<Row>(text, values);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
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

export async function ping(): Promise<boolean> {
  try {
    await pool.query('select 1');
    return true;
  } catch {
    return false;
  }
}
