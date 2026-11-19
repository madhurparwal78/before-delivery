import pg from 'pg';
import { config } from '../config.ts';
import { databaseUnavailable } from '../errors.ts';

export type Queryable = {
  query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<pg.QueryResult<Row>>;
};

const CONNECTION_ERROR_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'ETIMEDOUT',
  'ECONNRESET',
  'EHOSTUNREACH',
  'EAI_AGAIN',
  '57P01',
  '57P03',
  '08000',
  '08003',
  '08006',
]);

function isConnectionFailure(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: string }).code;
  if (code !== undefined && CONNECTION_ERROR_CODES.has(code)) return true;
  return /connect|terminat|shutdown|closed/i.test(error.message) && !/relation|column|syntax/i.test(error.message);
}

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 4_000,
});

pool.on('error', () => {
  /* a broken idle connection is dropped and replaced on the next query */
});

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult<Row>> {
  try {
    return await pool.query<Row>(text, values as unknown[]);
  } catch (error) {
    if (isConnectionFailure(error)) throw databaseUnavailable();
    throw error;
  }
}

export async function withTransaction<Result>(
  work: (client: Queryable) => Promise<Result>,
): Promise<Result> {
  let client: pg.PoolClient;
  try {
    client = await pool.connect();
  } catch (error) {
    if (isConnectionFailure(error)) throw databaseUnavailable();
    throw error;
  }
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      /* the connection is already gone */
    }
    if (isConnectionFailure(error)) throw databaseUnavailable();
    throw error;
  } finally {
    client.release();
  }
}
