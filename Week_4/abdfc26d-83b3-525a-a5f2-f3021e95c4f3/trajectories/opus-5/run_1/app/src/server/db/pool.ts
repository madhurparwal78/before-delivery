import pg from 'pg';
import { config } from '../config.js';

/** Money and credit columns are integers; never let pg hand them back as strings. */
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<R extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<pg.QueryResult<R>> {
  return pool.query<R>(sql, params as unknown[]);
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises concurrent work on one key across instances for the life of the transaction. */
export async function lockKey(client: Queryable, namespace: number, key: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [namespace, key]);
}

export const LOCK_NAMESPACE = {
  credits: 1,
  seed: 2,
  sequence: 3,
  order: 4,
  plan: 5,
} as const;

export function isUniqueViolation(error: unknown, constraint?: string): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const candidate = error as { code?: unknown; constraint?: unknown };
  if (candidate.code !== '23505') return false;
  return constraint === undefined || candidate.constraint === constraint;
}
