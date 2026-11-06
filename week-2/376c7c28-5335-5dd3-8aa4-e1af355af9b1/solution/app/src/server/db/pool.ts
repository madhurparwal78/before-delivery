import pg from 'pg';
import { createHash } from 'node:crypto';
import { config } from '../config.ts';

// Keep bigint and numeric columns as JavaScript numbers only where the app knows they are
// small integers; the app reads every such column through explicit casts in its queries.
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number.parseInt(value, 10));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value: string) => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', () => {
  /* a broken idle connection is dropped and replaced by the pool */
});

type Client = pg.PoolClient;

export interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<pg.QueryResult<R>>;
}

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const result = await pool.query<R>(sql, params as unknown[]);
  return result.rows;
}

async function one<R extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
): Promise<R | null> {
  const rows = await query<R>(sql, params);
  return rows[0] ?? null;
}

export async function withClient<T>(run: (client: Client) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

export async function transaction<T>(run: (client: Client) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('begin');
    try {
      const value = await run(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    }
  });
}

export async function rows<R extends pg.QueryResultRow = pg.QueryResultRow>(
  client: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<R[]> {
  const result = await client.query<R>(sql, params);
  return result.rows;
}

export async function first<R extends pg.QueryResultRow = pg.QueryResultRow>(
  client: Queryable,
  sql: string,
  params: readonly unknown[] = [],
): Promise<R | null> {
  const result = await rows<R>(client, sql, params);
  return result[0] ?? null;
}

/** A stable 64-bit key for a Postgres advisory lock, derived from a namespace and an id. */
export function lockKey(namespace: string, id: string): bigint {
  const digest = createHash('sha256').update(`${namespace}:${id}`).digest();
  return digest.readBigInt64BE(0);
}

/** Takes the named transaction-scoped advisory locks, always in a fixed order. */
export async function lockAll(client: Queryable, keys: readonly bigint[]): Promise<void> {
  const sorted = [...new Set(keys)].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  for (const key of sorted) {
    await client.query('select pg_advisory_xact_lock($1)', [key.toString()]);
  }
}
