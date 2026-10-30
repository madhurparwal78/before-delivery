import pg from 'pg';
import { config } from '../config.js';

const { Pool, types } = pg;

// Dates must stay calendar dates; timestamps come back as Date objects.
types.setTypeParser(1082, (value: string) => value);
types.setTypeParser(1700, (value: string) => value);

export const pool = new Pool({ connectionString: config.databaseUrl, max: 16 });

export type Queryable = Pick<pg.PoolClient, 'query'>;

export type Row = object;

export async function query<T extends Row>(
  client: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await client.query(text, values as unknown[]);
  return result.rows as T[];
}

export async function one<T extends Row>(
  client: Queryable,
  text: string,
  values: readonly unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(client, text, values);
  return rows[0] ?? null;
}

export async function withClient<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    return await run(client);
  } finally {
    client.release();
  }
}

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

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';
const MAX_ATTEMPTS = 8;

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const code = (error as { code?: unknown }).code;
  return code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED;
}

/**
 * Seat claims, pack movements and certificate writes run serialisably; a serialisation
 * failure means another request got there first, so the work is simply replayed.
 */
export async function withSerializable<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await withClient(async (client) => {
        await client.query('BEGIN ISOLATION LEVEL SERIALIZABLE');
        try {
          const result = await run(client);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK');
          throw error;
        }
      });
    } catch (error) {
      if (attempt >= MAX_ATTEMPTS || !isRetryable(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 10 + Math.floor(Math.random() * 15)));
    }
  }
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch {
      process.stdout.write('Waiting for Postgres…\n');
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
