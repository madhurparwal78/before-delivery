import pg from 'pg';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 5000 });
pool.on('error', (error) => console.error('postgres pool error:', error.message));

let ready = false;
export const databaseReady = (): boolean => ready;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS layouts (
  id text PRIMARY KEY,
  owner_id bigint NOT NULL REFERENCES users(id),
  name text NOT NULL,
  revision integer NOT NULL,
  state jsonb NOT NULL,
  view_token text UNIQUE,
  join_token text NOT NULL UNIQUE
);
CREATE TABLE IF NOT EXISTS memberships (
  id bigserial PRIMARY KEY,
  layout_id text NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  user_id bigint NOT NULL REFERENCES users(id),
  role text NOT NULL,
  UNIQUE (layout_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id, id DESC);
CREATE TABLE IF NOT EXISTS changes (
  layout_id text NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  author text NOT NULL,
  kind text NOT NULL,
  change jsonb NOT NULL,
  target jsonb NOT NULL,
  label text NOT NULL,
  inverse jsonb NOT NULL,
  PRIMARY KEY (layout_id, revision)
);
CREATE INDEX IF NOT EXISTS changes_author ON changes (layout_id, author, revision);
CREATE TABLE IF NOT EXISTS versions (
  layout_id text NOT NULL REFERENCES layouts(id) ON DELETE CASCADE,
  number integer NOT NULL,
  name text NOT NULL,
  revision integer NOT NULL,
  state jsonb NOT NULL,
  PRIMARY KEY (layout_id, number)
);
`;

const SCHEMA_LOCK = 481516;

/** Apply the schema, serialised across app processes; retry every second until Postgres answers. */
export async function bootDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query('SELECT pg_advisory_lock($1)', [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query('SELECT pg_advisory_unlock($1)', [SCHEMA_LOCK]);
      } finally {
        client.release();
      }
      ready = true;
      return;
    } catch (error) {
      console.error('postgres not ready:', (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function inTransaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((rollbackError: Error) => console.error('rollback failed:', rollbackError.message));
    throw error;
  } finally {
    client.release();
  }
}
