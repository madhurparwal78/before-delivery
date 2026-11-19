import { Pool, types } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

const DATE_OID = 1082;
types.setTypeParser(DATE_OID, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

export interface Queryable {
  query<R extends QueryResultRow>(sql: string, params?: unknown[]): Promise<{ rows: R[]; rowCount: number | null }>;
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}

export async function withTransaction<T>(fn: (tx: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}
