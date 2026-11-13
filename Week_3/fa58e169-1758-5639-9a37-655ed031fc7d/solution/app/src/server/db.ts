import pg from 'pg'
import { config } from './config.ts'

pg.types.setTypeParser(20, (value) => Number(value))

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 16 })
pool.on('error', () => undefined)

export type Db = pg.Pool | pg.PoolClient

export async function rows<T = Record<string, unknown>>(db: Db, text: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(text, params)).rows as T[]
}

export async function one<T = Record<string, unknown>>(db: Db, text: string, params: unknown[] = []): Promise<T | undefined> {
  return (await rows<T>(db, text, params))[0]
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await work(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw error
  } finally {
    client.release()
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  reduce_motion boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verify_tokens (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS patterns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users,
  name text NOT NULL,
  craft text NOT NULL,
  mode text NOT NULL,
  terms text,
  cast_on integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  published_version integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS pattern_colours (
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  letter text NOT NULL,
  name text NOT NULL,
  hex text NOT NULL,
  PRIMARY KEY (pattern_id, letter)
);
CREATE TABLE IF NOT EXISTS cells (
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  row integer NOT NULL,
  col integer NOT NULL,
  stitch text NOT NULL,
  colour text NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  by_user uuid,
  PRIMARY KEY (pattern_id, row, col)
);
CREATE TABLE IF NOT EXISTS repeats (
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  id text NOT NULL,
  from_col integer NOT NULL,
  to_col integer NOT NULL,
  from_row integer NOT NULL,
  to_row integer NOT NULL,
  times integer NOT NULL,
  PRIMARY KEY (pattern_id, id)
);
CREATE TABLE IF NOT EXISTS co_designers (
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  PRIMARY KEY (pattern_id, user_id)
);
CREATE TABLE IF NOT EXISTS versions (
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  version integer NOT NULL,
  note text NOT NULL,
  saved_on text NOT NULL,
  cast_on integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  colours jsonb NOT NULL,
  repeats jsonb NOT NULL,
  grid jsonb NOT NULL,
  PRIMARY KEY (pattern_id, version)
);
CREATE TABLE IF NOT EXISTS testers (
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  version integer NOT NULL,
  row integer NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pattern_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  email text NOT NULL,
  status text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS notes (
  id bigserial PRIMARY KEY,
  pattern_id uuid NOT NULL REFERENCES patterns ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  version integer NOT NULL,
  row integer NOT NULL,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS edit_ops (
  user_id uuid NOT NULL,
  op_id text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (user_id, op_id)
);
CREATE TABLE IF NOT EXISTS counter_steps (
  pattern_id uuid NOT NULL,
  user_id uuid NOT NULL,
  step_id text NOT NULL,
  PRIMARY KEY (pattern_id, user_id, step_id)
);
CREATE INDEX IF NOT EXISTS notes_pattern ON notes (pattern_id, row);
CREATE INDEX IF NOT EXISTS invites_pattern ON invites (pattern_id, email);
`

/** Applies the schema idempotently; an advisory lock serialises instances that start together. */
export async function migrate(): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('SELECT pg_advisory_lock(7421001)')
    await client.query(SCHEMA)
    await client.query('SELECT pg_advisory_unlock(7421001)')
  } finally {
    client.release()
  }
}
