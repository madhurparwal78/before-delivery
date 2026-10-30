import pg from "pg";
import { config } from "./config.js";
export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));
export async function tx(work) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        throw error;
    }
    finally {
        client.release();
    }
}
export async function one(db, sql, params = []) {
    return (await db.query(sql, params)).rows[0];
}
export async function many(db, sql, params = []) {
    return (await db.query(sql, params)).rows;
}
const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text UNIQUE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('mentor', 'learner')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('one_to_one', 'group')),
  owner_id uuid NOT NULL REFERENCES users(id),
  file_epoch bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sign_in_tokens (
  token_hash text PRIMARY KEY,
  email text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  invite_project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE INDEX IF NOT EXISTS sign_in_tokens_email ON sign_in_tokens (email);
CREATE TABLE IF NOT EXISTS memberships (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('mentor', 'student')),
  email_status text NOT NULL DEFAULT 'none' CHECK (email_status IN ('none', 'sent', 'queued')),
  seq bigserial,
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email text NOT NULL,
  name text NOT NULL,
  email_status text NOT NULL CHECK (email_status IN ('sent', 'queued')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title text NOT NULL,
  state text NOT NULL CHECK (state IN ('scheduled', 'live', 'paused', 'ended')),
  scheduled_for timestamptz NOT NULL,
  driver_id uuid REFERENCES users(id) ON DELETE SET NULL,
  version integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS sessions_one_running ON sessions (project_id) WHERE state IN ('live', 'paused');
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  path text NOT NULL,
  content bytea NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  sha256 text NOT NULL,
  size integer NOT NULL,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS files_live_path ON files (project_id, path) WHERE deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS edit_log (
  id bigserial PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  file_id uuid NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  revision integer NOT NULL,
  sha256 text,
  at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS checkpoints (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  state text NOT NULL CHECK (state IN ('pending_upload', 'saved', 'failed')),
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS checkpoint_files (
  checkpoint_id uuid NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  file_id uuid NOT NULL,
  path text NOT NULL,
  sha256 text NOT NULL,
  size integer NOT NULL,
  PRIMARY KEY (checkpoint_id, file_id)
);
CREATE TABLE IF NOT EXISTS checkpoint_staged (
  checkpoint_id uuid NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  content bytea NOT NULL,
  PRIMARY KEY (checkpoint_id, sha256)
);
CREATE TABLE IF NOT EXISTS restores (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  checkpoint_id uuid REFERENCES checkpoints(id) ON DELETE SET NULL,
  checkpoint_name text NOT NULL,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('applied', 'undone')),
  epoch_after bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS restore_files (
  restore_id uuid NOT NULL REFERENCES restores(id) ON DELETE CASCADE,
  file_id uuid NOT NULL,
  path text NOT NULL,
  content bytea NOT NULL,
  PRIMARY KEY (restore_id, file_id)
);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  state text NOT NULL CHECK (state IN ('planned', 'applied', 'superseded', 'expired')),
  plan jsonb NOT NULL,
  expires_at timestamptz NOT NULL,
  quarantine_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS imports_sweep ON imports (expires_at) WHERE state = 'planned' OR NOT quarantine_deleted;
CREATE TABLE IF NOT EXISTS reviewer_links (
  id uuid PRIMARY KEY,
  checkpoint_id uuid NOT NULL REFERENCES checkpoints(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  email_status text NOT NULL CHECK (email_status IN ('none', 'sent', 'queued')),
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer NOT NULL,
  body json NOT NULL,
  subject_user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  invite_id uuid REFERENCES invites(id) ON DELETE CASCADE,
  link_id uuid REFERENCES reviewer_links(id) ON DELETE CASCADE,
  locked_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit_events (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type text NOT NULL,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  subject jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  seq bigserial
);
CREATE TABLE IF NOT EXISTS storage_deletions (
  key text PRIMARY KEY,
  is_prefix boolean NOT NULL,
  locked_until timestamptz NOT NULL DEFAULT now()
);
`;
export async function migrate() {
    const client = await pool.connect();
    try {
        await client.query("SELECT pg_advisory_lock(727001)");
        await client.query(SCHEMA);
    }
    finally {
        await client.query("SELECT pg_advisory_unlock(727001)").catch(() => undefined);
        client.release();
    }
}
