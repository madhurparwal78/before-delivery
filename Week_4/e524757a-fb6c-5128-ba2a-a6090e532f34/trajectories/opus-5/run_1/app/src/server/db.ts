import pg from 'pg';
import { config } from './config.js';
import { ApiError } from '../shared/errors.js';
import schemaSql from './schema.sql';

export type Queryable = {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values?: unknown[]): Promise<pg.QueryResult<R>>;
};

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 2_000,
  application_name: 'hushfoot',
});

pool.on('error', () => {
  /* a dropped idle connection is replaced by the pool */
});

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<R>> {
  try {
    return await pool.query<R>(text, values);
  } catch (error) {
    if (isConnectionFailure(error)) {
      throw new ApiError('database_unavailable');
    }
    throw error;
  }
}

export async function transaction<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isConnectionFailure(error)) {
      throw new ApiError('database_unavailable');
    }
    throw error;
  }
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    if (isConnectionFailure(error)) {
      throw new ApiError('database_unavailable');
    }
    throw error;
  } finally {
    client.release();
  }
}

function isConnectionFailure(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  if (code === undefined) return error instanceof Error && /timeout|terminated|ECONN|socket/i.test(error.message);
  return ['ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EHOSTUNREACH', '57P01', '57P03', '08006', '08003'].includes(code);
}

export async function applySchema(): Promise<void> {
  await pool.query(schemaSql);
}

export async function pingDatabase(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
