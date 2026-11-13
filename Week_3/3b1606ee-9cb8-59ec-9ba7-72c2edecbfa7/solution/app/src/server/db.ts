import pg from 'pg';
import { config } from './config.js';
import { SCHEMA } from './schema.js';

pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on('error', () => undefined);

export type Queryable = Pick<pg.Pool, 'query'>;

export async function query<T extends object>(db: Queryable, text: string, values: unknown[] = []): Promise<T[]> {
  const result = await db.query(text, values);
  return result.rows as T[];
}

export async function one<T extends object>(db: Queryable, text: string, values: unknown[] = []): Promise<T | null> {
  return (await query<T>(db, text, values))[0] ?? null;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

const SCHEMA_LOCK = 7000;
export const LETTER_LOCK = 7001;

/** Waits for PostgreSQL for up to a minute, then applies the schema. Throws when it never answers. */
export async function connectAndMigrate(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query('SELECT 1');
      break;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  await transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock($1)', [SCHEMA_LOCK]);
    await client.query(SCHEMA);
  });
}
