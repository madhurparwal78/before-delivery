import pg from 'pg';
import { config } from '../config.js';
import { SCHEMA } from './schema.js';

const SCHEMA_LOCK = 4_173_001;
const BOOT_RETRY_MS = 60_000;
const BOOT_RETRY_STEP_MS = 1_000;

// Dates come back as the strings Postgres prints, never as local-time Date objects.
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', () => undefined);

export type Row = Record<string, unknown>;

export const query = async <T extends Row>(sql: string, params: unknown[] = []): Promise<T[]> =>
  (await pool.query<T>(sql, params)).rows;

export type Db = { query: <T extends Row>(sql: string, params?: unknown[]) => Promise<T[]> };

/** Queries outside any transaction. */
export const direct: Db = { query };

const on = (client: pg.PoolClient): Db => ({
  query: async <T extends Row>(sql: string, params: unknown[] = []) => (await client.query<T>(sql, params)).rows,
});

export const transaction = async <T>(work: (db: Db) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(on(client));
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
};

/** Applies the schema; waits for Postgres for up to 60 seconds at boot. */
export const applySchema = async (): Promise<void> => {
  const deadline = Date.now() + BOOT_RETRY_MS;
  for (;;) {
    try {
      await transaction(async (db) => {
        await db.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
        await db.query(SCHEMA);
      });
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, BOOT_RETRY_STEP_MS));
    }
  }
};
