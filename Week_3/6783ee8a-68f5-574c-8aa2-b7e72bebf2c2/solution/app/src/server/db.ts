import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";
import { settings } from "./config";

export const pool = new Pool({ connectionString: settings.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = Pick<PoolClient, "query">;

export async function query<Row extends QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<Row[]> {
  return (await db.query<Row>(text, values)).rows;
}

export async function queryOne<Row extends QueryResultRow>(db: Db, text: string, values: unknown[] = []): Promise<Row | null> {
  return (await db.query<Row>(text, values)).rows[0] ?? null;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  use_case text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS notebooks (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  title text NOT NULL,
  imported boolean NOT NULL DEFAULT false,
  execution_counter integer NOT NULL DEFAULT 0,
  checkpoint_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  modified_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notebooks_owner ON notebooks (owner_id);
CREATE TABLE IF NOT EXISTS cells (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  id text NOT NULL,
  position integer NOT NULL,
  cell_type text NOT NULL,
  source text NOT NULL DEFAULT '',
  revision integer NOT NULL DEFAULT 1,
  execution_count integer,
  run_state text NOT NULL DEFAULT 'idle',
  outputs json NOT NULL DEFAULT '[]',
  outputs_version integer NOT NULL DEFAULT 0,
  metadata json NOT NULL DEFAULT '{}',
  PRIMARY KEY (notebook_id, id)
);
CREATE INDEX IF NOT EXISTS cells_order ON cells (notebook_id, position);
CREATE TABLE IF NOT EXISTS deleted_cells (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  id text NOT NULL,
  position integer NOT NULL,
  seq bigserial,
  payload json NOT NULL,
  PRIMARY KEY (notebook_id, id)
);
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  email text NOT NULL,
  user_id text REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shares_email_key ON shares (notebook_id, lower(email));
CREATE INDEX IF NOT EXISTS shares_user ON shares (user_id);
CREATE TABLE IF NOT EXISTS runs (
  run_id text PRIMARY KEY,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  cell_id text NOT NULL,
  tab_id text NOT NULL,
  state text NOT NULL,
  prev_run_state text NOT NULL,
  fingerprint text,
  execution_count integer,
  response json,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS runs_notebook ON runs (notebook_id);
CREATE TABLE IF NOT EXISTS kernel_tabs (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  tab_id text NOT NULL,
  status text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (notebook_id, tab_id)
);
CREATE TABLE IF NOT EXISTS presence (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  tab_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  cell_id text,
  last_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (notebook_id, tab_id)
);
CREATE TABLE IF NOT EXISTS cell_locks (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  cell_id text NOT NULL,
  tab_id text NOT NULL,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_seen timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (notebook_id, cell_id)
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id text PRIMARY KEY,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  number integer NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notebook_id, number)
);
CREATE TABLE IF NOT EXISTS search_pending (
  notebook_id text PRIMARY KEY,
  op text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
`;

const SCHEMA_LOCK = 4173001;

/** Waits for PostgreSQL, retrying every second, then applies the schema; running it again changes nothing. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
      } finally {
        client.release();
      }
      return;
    } catch (error) {
      console.error("waiting for postgres:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}
