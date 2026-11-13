import type { Db, QueryResultRow } from './db.js';

export async function dbOne<T extends QueryResultRow>(db: Db, sql: string, params: unknown[]): Promise<T | null> {
  const res = await db.query(sql, params);
  return (res.rows[0] as T | undefined) ?? null;
}

export async function dbAll<T extends QueryResultRow>(db: Db, sql: string, params: unknown[]): Promise<T[]> {
  const res = await db.query(sql, params);
  return res.rows as T[];
}
