import { Pool, PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 16 });

export type Row = QueryResultRow;

export interface Queryable {
  query<T extends Row>(text: string, values?: readonly unknown[]): Promise<{ rows: T[]; rowCount: number }>;
}

export const db: Queryable = {
  async query<T extends Row>(text: string, values?: readonly unknown[]) {
    const result = await pool.query<T>(text, values as unknown[]);
    return { rows: result.rows, rowCount: result.rowCount ?? 0 };
  },
};

export async function tx<T>(fn: (client: Queryable) => Promise<T>): Promise<T> {
  const client: PoolClient = await pool.connect();
  const queryable: Queryable = {
    async query<R extends Row>(text: string, values?: readonly unknown[]) {
      const result = await client.query<R>(text, values as unknown[]);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
  };
  try {
    await client.query('BEGIN');
    const value = await fn(queryable);
    await client.query('COMMIT');
    return value;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function big(value: unknown): bigint {
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') return BigInt(value);
  if (typeof value === 'string') return BigInt(value);
  throw new Error(`Cannot read ${String(value)} as a bigint`);
}

export function bigOrNull(value: unknown): bigint | null {
  return value === null || value === undefined ? null : big(value);
}

export async function lockTeam(client: Queryable, teamId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`team:${teamId}`]);
}

export async function lockNamed(client: Queryable, name: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [name]);
}

export async function nextId(client: Queryable, sequence: string, prefix: string): Promise<string> {
  const { rows } = await client.query<{ value: string }>(`SELECT nextval('${sequence}')::text AS value`);
  return `${prefix}${rows[0]!.value}`;
}
