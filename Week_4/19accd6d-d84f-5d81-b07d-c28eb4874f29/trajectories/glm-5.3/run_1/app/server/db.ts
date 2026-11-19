import { Pool, type PoolClient } from 'pg';

export const pool = new Pool({ connectionString: loadDbUrl() });

function loadDbUrl(): string {
  return process.env.DATABASE_URL ?? '';
}

/** Idempotent schema, applied at every start (Services / DP-01). */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  email_ci text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS verify_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS teams (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS team_members (
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (team_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  team_id text NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  accepted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS recipes (
  id text PRIMARY KEY,
  owner_type text NOT NULL,
  owner_user_id text REFERENCES users(id) ON DELETE CASCADE,
  owner_team_id text REFERENCES teams(id) ON DELETE CASCADE,
  current_version int NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((owner_type = 'user' AND owner_user_id IS NOT NULL AND owner_team_id IS NULL)
       OR (owner_type = 'team' AND owner_team_id IS NOT NULL AND owner_user_id IS NULL))
);
CREATE TABLE IF NOT EXISTS versions (
  recipe_id text NOT NULL REFERENCES recipes(id) ON DELETE CASCADE,
  n int NOT NULL,
  name text NOT NULL,
  note text NOT NULL DEFAULT '',
  tags jsonb NOT NULL DEFAULT '[]',
  steps jsonb NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (recipe_id, n)
);
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  bytes int NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS snapshots (
  token text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  recipe_id text REFERENCES recipes(id) ON DELETE SET NULL,
  recipe_version int,
  recipe_name text,
  steps jsonb NOT NULL,
  input_file_id text,
  input_b64 text,
  input_bytes int NOT NULL,
  output_file_id text,
  output_b64 text,
  output_bytes int NOT NULL,
  ttl text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  owner_type text NOT NULL,
  owner_user_id text,
  owner_team_id text,
  text_hash text NOT NULL,
  status text NOT NULL,
  report jsonb NOT NULL DEFAULT '{}',
  recipe_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS outage_state (
  id int PRIMARY KEY DEFAULT 1,
  minio_down boolean NOT NULL DEFAULT false,
  meili_down boolean NOT NULL DEFAULT false,
  live_down boolean NOT NULL DEFAULT false
);
INSERT INTO outage_state (id, minio_down, meili_down, live_down) VALUES (1, false, false, false)
  ON CONFLICT (id) DO NOTHING;
CREATE INDEX IF NOT EXISTS versions_recipe_idx ON versions (recipe_id, n DESC);
CREATE INDEX IF NOT EXISTS recipes_owner_idx ON recipes (owner_type, owner_user_id, owner_team_id);
CREATE INDEX IF NOT EXISTS imports_user_idx ON imports (user_id, text_hash);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

export { config } from './types.js';
export type { Config } from './types.js';