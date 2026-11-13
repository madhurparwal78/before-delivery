import pg from 'pg';
import { config, DATABASE_RETRY_MS } from './config.js';
import { SCHEMA } from './schema.js';

pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl });
pool.on('error', () => undefined);

export type Queryable = Pick<pg.Pool, 'query'>;

/** The single row a write or lookup is known to produce. */
export function one<T>(result: { rows: T[] }): T {
  const [row] = result.rows;
  if (row === undefined) throw new Error('the query returned no row');
  return row;
}
export type Tx = pg.PoolClient;

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
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

const MIGRATION_LOCK = 724_001;

/** Creates every table that is missing; safe to run on every serve and from several instances at once. */
async function migrate(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock($1)', [MIGRATION_LOCK]);
    await tx.query(SCHEMA);
  });
}

let ready = false;
export const databaseReady = (): boolean => ready;

/** Keeps trying every second until the database answers, then sets the schema up. */
export function connectWhenReachable(onReady: () => Promise<void>): void {
  const attempt = async (): Promise<void> => {
    try {
      await migrate();
      await onReady();
      ready = true;
    } catch {
      setTimeout(() => void attempt(), DATABASE_RETRY_MS);
    }
  };
  void attempt();
}
