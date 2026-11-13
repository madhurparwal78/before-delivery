import { PgPool, Tx } from './pg.ts';
import type { Row, Value, QueryResult } from './pg.ts';

export interface Db {
  query(sql: string, params?: Value[]): Promise<QueryResult>;
  withConnection<T>(fn: (c: { query(sql: string, params?: Value[]): Promise<QueryResult> }) => Promise<T>): Promise<T>;
}

export async function connect(url: string, size = 8): Promise<PgPool> {
  const pool = new PgPool(url, size);
  const conn = await pool.acquire();
  await conn.query('select 1');
  pool.release(conn);
  return pool;
}

export type { PgPool, Tx, Row, Value, QueryResult };
