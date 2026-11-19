import { Pool, type PoolClient, type QueryResultRow } from 'pg';
import { config } from './config';

const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

export type Db = Pick<PoolClient, 'query'>;

export async function query<T extends QueryResultRow>(sql: string, params: readonly unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function withTransaction<T>(run: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const value = await run(client);
    await client.query('commit');
    return value;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withClient<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function rows<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await db.query<T>(sql, params as unknown[]);
  return result.rows;
}

export async function first<T extends QueryResultRow>(
  db: Db,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | undefined> {
  const result = await db.query<T>(sql, params as unknown[]);
  return result.rows[0];
}
