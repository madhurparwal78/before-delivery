import pg from 'pg';
import { config } from './config';
import { SCHEMA } from './schema';
import { SERVICES_SCHEMA } from './schema-services';

export type Queryable = Pick<pg.PoolClient, 'query'>;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 30 });
pool.on('error', () => undefined);

let ready = false;
export const databaseReady = (): boolean => ready;

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

/**
 * Runs `work` in one transaction. Every transaction first reads the clock row, so the grading reset
 * (which locks that table exclusively) waits for transactions in flight.
 */
async function inTransaction<T>(begin: string, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query(begin);
    await client.query('SELECT 1 FROM app_clock');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export const transaction = <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> => inTransaction('BEGIN', work);

/** One read-only transaction over a single snapshot: everything `work` reads agrees. */
export const snapshot = <T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> =>
  inTransaction('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', work);

const MIGRATION_LOCK = 727001;

async function migrateOnce(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    for (const statement of [...SCHEMA, ...SERVICES_SCHEMA]) await client.query(statement);
    const offset = new Date(config.startAt).getTime() - Date.now();
    await client.query('INSERT INTO app_clock (id, offset_ms) VALUES (1, $1) ON CONFLICT (id) DO NOTHING', [offset]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Applies the schema idempotently, retrying until PostgreSQL answers. API routes answer 503 meanwhile. */
export async function migrate(): Promise<void> {
  for (;;) {
    try {
      await migrateOnce();
      ready = true;
      return;
    } catch (error) {
      console.error(`PostgreSQL is not ready: ${(error as Error).message}`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
