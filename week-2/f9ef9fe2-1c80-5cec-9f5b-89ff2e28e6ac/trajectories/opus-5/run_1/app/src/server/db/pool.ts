import { Pool, types, type PoolClient, type QueryResultRow } from 'pg';
import { env } from '../env.js';

/** Kitchen dates stay plain `YYYY-MM-DD` strings; the device zone never takes part. */
types.setTypeParser(1082, (value: string) => value);

export const pool = new Pool({ connectionString: env.databaseUrl, max: 12 });

export type Sql = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow>(
  client: Sql,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  client: Sql,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(client, text, values);
  return rows[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
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

/**
 * Serialises every claim on the cells of one kitchen day, so that when several
 * requests race for a cell exactly one of them takes it.
 */
export async function lockKitchenDay(
  client: Sql,
  kitchenId: string,
  date: string,
): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [kitchenId, date]);
}
