import pg from 'pg';
import { config } from './config.js';
import { SCHEMA_SQL } from './schema.js';
import { fail } from './http/errors.js';

const { Pool, types } = pg;

// Dates and numerics come back as plain strings, never as local-clock Date objects.
types.setTypeParser(1082, (value: string) => value);
types.setTypeParser(1700, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 12 });

pool.on('error', () => {
  /* a broken idle connection is dropped from the pool and retried on next use */
});

export type QueryParam = string | number | boolean | null | string[] | Date;

export interface Client {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    sql: string,
    params?: QueryParam[],
  ): Promise<pg.QueryResult<Row>>;
}

let databaseReady = false;

export function isDatabaseReady(): boolean {
  return databaseReady;
}

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
): Promise<pg.QueryResult<Row>> {
  try {
    return await pool.query<Row>(sql, params);
  } catch (error) {
    throw rewrite(error);
  }
}

/** Runs a unit of work in one transaction. */
export async function transaction<Result>(work: (client: Client) => Promise<Result>): Promise<Result> {
  let connection: pg.PoolClient;
  try {
    connection = await pool.connect();
  } catch (error) {
    throw rewrite(error);
  }
  try {
    await connection.query('begin');
    const result = await work(connection);
    await connection.query('commit');
    return result;
  } catch (error) {
    await connection.query('rollback').catch(() => undefined);
    throw rewrite(error);
  } finally {
    connection.release();
  }
}

function rewrite(error: unknown): unknown {
  if (error instanceof Error && 'code' in error) {
    const code = (error as { code?: string }).code;
    if (code === 'ECONNREFUSED' || code === 'ENOTFOUND' || code === 'ETIMEDOUT' || code === '57P03') {
      databaseReady = false;
      return fail('database_unavailable');
    }
  }
  if (error instanceof Error && error.message === 'Connection terminated unexpectedly') {
    databaseReady = false;
    return fail('database_unavailable');
  }
  return error;
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
  databaseReady = true;
}

export async function checkDatabase(): Promise<boolean> {
  try {
    await pool.query('select 1');
    databaseReady = true;
    return true;
  } catch {
    databaseReady = false;
    return false;
  }
}
