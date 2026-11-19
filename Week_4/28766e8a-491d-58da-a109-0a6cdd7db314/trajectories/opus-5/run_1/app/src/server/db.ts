import { Pool, type PoolClient, types } from 'pg';
import { config } from './env.js';

/** Read bigint columns as numbers; every `seq` and count here is far below 2^53. */
types.setTypeParser(types.builtins.INT8, (value) => Number(value));

export const pool = new Pool({ connectionString: config.databaseUrl, max: 16 });

export async function query<T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function queryOne<T extends Record<string, unknown>>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T | undefined> {
  const rows = await query<T>(text, values);
  return rows[0];
}

/** Runs `work` in one transaction, so sequence allocation and its document write commit together. */
export async function transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS diagrams (
  id text PRIMARY KEY,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  seq bigint NOT NULL DEFAULT 0,
  version_count integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  invited_by text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_diagram_idx ON invites (diagram_id);

CREATE TABLE IF NOT EXISTS operations (
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  op_id text NOT NULL,
  actor_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  response jsonb NOT NULL,
  inverse jsonb NOT NULL,
  changed_fields jsonb NOT NULL,
  undone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, seq)
);
CREATE UNIQUE INDEX IF NOT EXISTS operations_op_id_key ON operations (diagram_id, actor_id, op_id);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  page_id text NOT NULL,
  shape_id text NOT NULL,
  author_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  body text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  anchored boolean NOT NULL DEFAULT true,
  parent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_diagram_idx ON comments (diagram_id);

CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  number integer NOT NULL,
  name text,
  author_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_diagram_idx ON versions (diagram_id);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  page_id text NOT NULL,
  format text NOT NULL,
  scale integer NOT NULL,
  background text NOT NULL,
  status text NOT NULL,
  seq bigint NOT NULL,
  requested_by text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  document jsonb NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS exports_diagram_idx ON exports (diagram_id);

CREATE TABLE IF NOT EXISTS undo_stacks (
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  undo jsonb NOT NULL DEFAULT '[]'::jsonb,
  redo jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (diagram_id, user_id)
);

-- Every id that has ever belonged to a diagram, so a deleted object answers 409 while an
-- id that never belonged answers 404 under the not-found rule.
CREATE TABLE IF NOT EXISTS object_ids (
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  id text NOT NULL,
  kind text NOT NULL,
  PRIMARY KEY (diagram_id, id)
);

-- The last operation that set each field, for the same-field conflict and undo skip rules.
CREATE TABLE IF NOT EXISTS field_writers (
  diagram_id text NOT NULL REFERENCES diagrams (id) ON DELETE CASCADE,
  field text NOT NULL,
  actor_id text NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  PRIMARY KEY (diagram_id, field)
);

CREATE TABLE IF NOT EXISTS save_outages (
  diagram_id text PRIMARY KEY REFERENCES diagrams (id) ON DELETE CASCADE,
  until timestamptz NOT NULL
);
`;

/**
 * Applies the schema idempotently. Two instances starting against the same database at
 * once both succeed: the advisory lock serialises them and every statement is guarded.
 */
export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(728341)');
    await client.query(SCHEMA);
  } finally {
    await client.query('SELECT pg_advisory_unlock(728341)');
    client.release();
  }
}
