import pg from 'pg';
import { config } from '../config.js';

// Numeric and bigint columns arrive as strings by default; the app reads them as numbers
// only where the column is a count or a position, and as exact strings for money.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number.parseInt(value, 10));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export type QueryParameter = string | number | boolean | null | Date | Buffer | object;

export interface Queryable {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly QueryParameter[],
  ): Promise<pg.QueryResult<Row>>;
}

export async function withClient<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

/** Runs `run` inside a transaction, rolling back on any thrown error. */
export async function withTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return withClient(async (client) => {
    await client.query('BEGIN');
    try {
      const result = await run(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  });
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (error) {
      const delay = Math.min(5_000, 250 * 2 ** Math.min(attempt, 5));
      process.stderr.write(`Postgres is unreachable (${(error as Error).message}); retrying in ${delay}ms\n`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

export async function databaseIsUp(): Promise<boolean> {
  try {
    await pool.query('SELECT 1');
    return true;
  } catch {
    return false;
  }
}
