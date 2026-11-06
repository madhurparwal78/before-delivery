import type { Pool } from "pg";

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id text PRIMARY KEY,
      email text UNIQUE,
      name text NOT NULL,
      kind text NOT NULL,
      is_demo boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS auth_tokens (
      token_hash text PRIMARY KEY,
      email text NOT NULL,
      purpose text NOT NULL,
      project_id text,
      used_at timestamptz,
      expires_at timestamptz NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions_pg (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS projects (
      id text PRIMARY KEY,
      title text NOT NULL,
      kind text NOT NULL,
      owner_id text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS memberships (
      project_id text NOT NULL,
      user_id text NOT NULL,
      role text NOT NULL,
      joined_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS invite_email_status (
      project_id text NOT NULL,
      user_id text NOT NULL,
      email text NOT NULL,
      status text NOT NULL,
      updated_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (project_id, user_id)
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      title text NOT NULL,
      state text NOT NULL,
      scheduled_for timestamptz NOT NULL,
      driver_id text,
      version integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS files (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      path text NOT NULL,
      revision integer NOT NULL DEFAULT 1,
      sha256 text NOT NULL,
      size integer NOT NULL,
      content text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS files_project_path ON files (project_id, path);
    CREATE TABLE IF NOT EXISTS edit_log (
      id bigserial PRIMARY KEY,
      project_id text NOT NULL,
      file_id text NOT NULL,
      user_id text,
      user_name text NOT NULL,
      revision integer NOT NULL,
      sha256 text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS checkpoints (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      name text NOT NULL,
      state text NOT NULL,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      file_count integer NOT NULL
    );
    CREATE TABLE IF NOT EXISTS checkpoint_files (
      checkpoint_id text NOT NULL,
      file_id text NOT NULL,
      path text NOT NULL,
      sha256 text NOT NULL,
      size integer NOT NULL,
      content text NOT NULL,
      PRIMARY KEY (checkpoint_id, file_id)
    );
    CREATE TABLE IF NOT EXISTS restores (
      id text PRIMARY KEY,
      checkpoint_id text NOT NULL,
      project_id text NOT NULL,
      state text NOT NULL,
      undo_state jsonb NOT NULL,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS import_plans (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      state text NOT NULL,
      expires_at timestamptz NOT NULL,
      zip_key text NOT NULL,
      entries jsonb NOT NULL,
      only_in_project jsonb NOT NULL,
      ignored jsonb NOT NULL,
      file_revisions jsonb NOT NULL,
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS reviewer_links (
      id text PRIMARY KEY,
      checkpoint_id text NOT NULL,
      project_id text NOT NULL,
      token text NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      email text,
      email_status text NOT NULL DEFAULT 'none',
      created_by text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX IF NOT EXISTS reviewer_links_token ON reviewer_links (token);
    CREATE TABLE IF NOT EXISTS audit_events (
      id text PRIMARY KEY,
      project_id text NOT NULL,
      type text NOT NULL,
      actor_id text,
      actor_name text NOT NULL,
      subject text NOT NULL,
      at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS audit_project ON audit_events (project_id, at DESC);
    CREATE TABLE IF NOT EXISTS idempotency (
      user_id text NOT NULL,
      key text NOT NULL,
      request_hash text NOT NULL,
      status integer NOT NULL,
      response_body jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (user_id, key)
    );
    CREATE TABLE IF NOT EXISTS email_queue (
      id text PRIMARY KEY,
      to_email text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      status text NOT NULL,
      claimed_by text,
      claimed_at timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS email_queue_pending ON email_queue (status);
  `);
  await pool.query(`
    ALTER TABLE checkpoints ADD COLUMN IF NOT EXISTS upload_deadline timestamptz;
    ALTER TABLE import_plans ADD COLUMN IF NOT EXISTS sweep_claimed_at timestamptz;
    ALTER TABLE files ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
  `);
}
