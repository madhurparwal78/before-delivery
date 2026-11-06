import { Pool, types, type PoolClient } from 'pg';
import { config } from './config';

const DATE_OID = 1082;
const INT8_OID = 20;
types.setTypeParser(DATE_OID, (value) => value);
types.setTypeParser(INT8_OID, (value) => Number(value));

export type Row = Record<string, unknown>;

export const pool = new Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
});

pool.on('error', () => {
  /* a broken idle connection is replaced on the next checkout */
});

export interface Queryable {
  query(sql: string, params?: readonly unknown[]): Promise<{ rows: Row[]; rowCount: number | null }>;
}

export async function query<T extends Row = Row>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query(sql, params as unknown[]);
  return result.rows as T[];
}

export async function rows<T extends Row = Row>(
  client: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query(sql, params);
  return result.rows as T[];
}

export async function one<T extends Row = Row>(
  client: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<T | null> {
  const list = await rows<T>(client, sql, params);
  return list[0] ?? null;
}

export async function withTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function int(value: unknown): number {
  return typeof value === 'number' ? value : Number(value);
}

export function text(value: unknown): string {
  return String(value);
}

export function nullableText(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

/** A date column read back as a YYYY-MM-DD string. */
export function dateText(value: unknown): string {
  return String(value).slice(0, 10);
}

export function instant(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}
