import pg from 'pg';
import { config } from '../config.js';
import { ApiError, apiError } from '../http/errors.js';

export const UNIQUE_VIOLATION = '23505';

export interface Queryable {
  query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 4000,
  idleTimeoutMillis: 30_000,
});

pool.on('error', () => {
  /* a dropped idle connection is replaced on the next checkout */
});

function isPostgresError(error: unknown): error is { code: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    /^[0-9A-Z]{5}$/.test((error as { code: string }).code)
  );
}

export function databaseUnavailable(): never {
  throw apiError(
    503,
    'database_unavailable',
    'Saltprint Desk cannot reach its records right now. Nothing was saved.',
  );
}

function rethrow(error: unknown): never {
  if (error instanceof ApiError || isPostgresError(error)) throw error;
  databaseUnavailable();
}

export async function queryOn<T extends pg.QueryResultRow>(
  client: Queryable,
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  try {
    return await client.query<T>(sql, params);
  } catch (error) {
    rethrow(error);
  }
}

/** The pool itself as a queryable, for reads outside a transaction. */
export const db: Queryable = {
  query: <T extends pg.QueryResultRow>(sql: string, params?: unknown[]) => pool.query<T>(sql, params),
};

export async function query<T extends pg.QueryResultRow>(
  sql: string,
  params: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return queryOn<T>(db, sql, params);
}

export async function withTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    rethrow(error);
  }
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      /* the connection is already gone */
    }
    rethrow(error);
  } finally {
    client.release();
  }
}

/** Serialises licence requests, activations and takedowns on one essay. */
export async function withEssayLock<T>(
  essayId: string,
  run: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  return withTransaction(async (client) => {
    await queryOn(client, 'select pg_advisory_xact_lock(hashtext($1))', [`essay:${essayId}`]);
    return run(client);
  });
}
