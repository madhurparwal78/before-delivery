import pg from 'pg';
import { env } from './env.ts';

export type Queryable = Pick<pg.PoolClient, 'query'>;

/** An instance holds at most 12 Postgres connections: this pool plus the one stream listener. */
const POOL_MAX = 10;

export const pool = new pg.Pool({
  connectionString: env.databaseUrl,
  max: POOL_MAX,
  idleTimeoutMillis: 10_000,
  connectionTimeoutMillis: 10_000,
});

export async function query<R extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult<R>> {
  return pool.query<R>(text, values as unknown[]);
}

const COMMIT_ORDER_LOCK = 8_421_377;

/**
 * Runs a write in one transaction holding the single commit-order lock, so every write that
 * writes an audit row takes its place in one commit order shared across all instances.
 */
export async function withCommitOrder<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [COMMIT_ORDER_LOCK]);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Reads run in one repeatable-read snapshot, so no read straddles a commit. */
export async function withReadTransaction<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withTransaction<T>(run: (client: Queryable) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
