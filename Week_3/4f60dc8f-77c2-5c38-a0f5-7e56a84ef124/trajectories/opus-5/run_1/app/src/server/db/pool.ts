import pg from 'pg';
import { config } from '../config.js';
import { SCHEMA_SQL } from './schema.js';

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => value);
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => value);

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  statement_timeout: 20_000,
});

pool.on('error', () => {
  /* a broken idle client is replaced on the next checkout */
});

export type Queryable = {
  query: <R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ) => Promise<pg.QueryResult<R>>;
};

export const query = async <R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<pg.QueryResult<R>> => pool.query<R>(text, values);

export const transaction = async <T>(run: (client: Queryable) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already gone; releasing it below discards it */
    }
    throw error;
  } finally {
    client.release();
  }
};

let schemaReady: Promise<void> | null = null;

/** Applied idempotently, and retried on the next request until it succeeds. */
export const ensureSchema = async (): Promise<void> => {
  if (schemaReady === null) {
    schemaReady = pool
      .query(SCHEMA_SQL)
      .then(() => undefined)
      .catch((error: unknown) => {
        schemaReady = null;
        throw error;
      });
  }
  return schemaReady;
};
