import pg from 'pg';
import { config } from '../config.js';

const DATE_OID = 1082;
pg.types.setTypeParser(DATE_OID, (value: string) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export type QueryParam = string | number | boolean | null | Date | Buffer;

export interface Queryable {
  query<Row extends pg.QueryResultRow>(sql: string, params?: QueryParam[]): Promise<pg.QueryResult<Row>>;
}

export async function rows<Row extends pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
  client: Queryable = pool,
): Promise<Row[]> {
  const result = await client.query<Row>(sql, params);
  return result.rows;
}

export async function oneRow<Row extends pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
  client: Queryable = pool,
): Promise<Row | null> {
  const found = await rows<Row>(sql, params, client);
  return found[0] ?? null;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function waitForDatabase(timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await pool.query('select 1');
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export function isUniqueViolation(error: unknown, constraint: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    error.code === '23505' &&
    'constraint' in error &&
    error.constraint === constraint
  );
}
