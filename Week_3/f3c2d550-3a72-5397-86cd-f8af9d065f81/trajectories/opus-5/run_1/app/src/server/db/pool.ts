import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { SCHEMA_SQL } from './schema.js';

const { Pool, types } = pg;

// Timestamps and dates are read as text so that the server clock, not the driver's host
// time zone, decides every instant.
types.setTypeParser(1114, (value) => value);
types.setTypeParser(1184, (value) => value);
types.setTypeParser(1082, (value) => value);
types.setTypeParser(20, (value) => Number(value));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 12,
  idleTimeoutMillis: 30_000,
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function withTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const result = await run(client);
    await client.query('commit');
    return result;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Advisory lock keys, so that copies starting or sweeping together do the work once. */
export const LOCK = {
  schema: 918_344_101,
  seed: 918_344_102,
  searchCatchUp: 918_344_103,
  purge: 918_344_104,
  indexRebuild: 918_344_105,
} as const;

export async function withAdvisoryLock<T>(
  key: number,
  run: () => Promise<T>,
): Promise<T | null> {
  const client = await pool.connect();
  try {
    const taken = await client.query<{ locked: boolean }>(
      'select pg_try_advisory_lock($1) as locked',
      [key],
    );
    if (!taken.rows[0]?.locked) return null;
    try {
      return await run();
    } finally {
      await client.query('select pg_advisory_unlock($1)', [key]);
    }
  } finally {
    client.release();
  }
}

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('select pg_advisory_lock($1)', [LOCK.schema]);
    try {
      await client.query(SCHEMA_SQL);
    } finally {
      await client.query('select pg_advisory_unlock($1)', [LOCK.schema]);
    }
  } finally {
    client.release();
  }
}

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

export function newId(prefix: string): string {
  const bytes = randomBytes(16);
  let id = '';
  for (const byte of bytes) id += ID_ALPHABET[byte % ID_ALPHABET.length];
  return `${prefix}_${id}`;
}
