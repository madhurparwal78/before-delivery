import pg from 'pg';
import { config } from '../config.js';

/** `date` columns stay the plain YYYY-MM-DD strings every calendar rule works on. */
pg.types.setTypeParser(1082, (value: string) => value);
/** `bigint` columns here only ever hold paise and counts, which fit a JS number. */
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

pool.on('error', () => {
  recordFailure();
});

let available = false;

export function databaseAvailable(): boolean {
  return available;
}

function recordFailure(): void {
  available = false;
}

export type Queryable = pg.PoolClient | pg.Pool;

export async function ping(): Promise<boolean> {
  try {
    await pool.query('select 1');
    available = true;
  } catch {
    available = false;
  }
  return available;
}

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<T>> {
  try {
    const result = await pool.query<T>(text, values);
    available = true;
    return result;
  } catch (error) {
    if (isConnectionProblem(error)) recordFailure();
    throw error;
  }
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect().catch((error: unknown) => {
    recordFailure();
    throw error;
  });
  try {
    await client.query('begin');
    const result = await fn(client);
    await client.query('commit');
    available = true;
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      recordFailure();
    }
    if (isConnectionProblem(error)) recordFailure();
    throw error;
  } finally {
    client.release();
  }
}

export function isConnectionProblem(error: unknown): boolean {
  const code = (error as { code?: string }).code;
  return (
    code === 'ECONNREFUSED' ||
    code === 'ENOTFOUND' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === '57P01' ||
    code === '08006' ||
    code === '08003' ||
    code === '08001'
  );
}

export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}
