import { Pool } from "pg";
import type { PoolClient, QueryResultRow } from "pg";
import { settings } from "./config";

export const pool = new Pool({ connectionString: settings.databaseUrl, max: 12 });
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
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);
CREATE INDEX IF NOT EXISTS team_members_user ON team_members (user_id);
CREATE TABLE IF NOT EXISTS team_invites (
  token_hash text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  inviter_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS recipes (
  id text PRIMARY KEY,
  owner_user_id text REFERENCES users(id),
  team_id text REFERENCES teams(id) ON DELETE CASCADE,
  latest_version integer NOT NULL,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  indexed_version integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_user_id IS NULL) <> (team_id IS NULL))
);
CREATE INDEX IF NOT EXISTS recipes_owner ON recipes (owner_user_id);
CREATE INDEX IF NOT EXISTS recipes_team ON recipes (team_id);
CREATE TABLE IF NOT EXISTS recipe_versions (
  recipe_id text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  n integer NOT NULL,
  name text NOT NULL,
  note text NOT NULL,
  tags jsonb NOT NULL,
  steps json NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, n)
);
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  name text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snapshots (
  token text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id),
  recipe_name text NOT NULL,
  recipe_version integer,
  steps json NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  confirmed_at timestamptz,
  revoked_at timestamptz,
  input_bytes integer NOT NULL,
  output_bytes integer NOT NULL,
  input_sha256 text NOT NULL,
  output_sha256 text NOT NULL,
  pending_input bytea,
  pending_output bytea
);
CREATE TABLE IF NOT EXISTS import_attempts (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  text_hash text NOT NULL,
  status text NOT NULL,
  recipe_id text REFERENCES recipes(id) ON DELETE SET NULL,
  version integer,
  report jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS import_attempts_user ON import_attempts (user_id, text_hash);
`;

const SCHEMA_LOCK = 4173001;

/** Waits for PostgreSQL, retrying every 2 seconds, then applies the schema; running it again changes nothing. */
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
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
