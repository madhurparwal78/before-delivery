import type { Pool } from "pg";

/** Idempotent schema; safe when two instances start against the same database. */
export async function applySchema(pool: Pool): Promise<void> {
  await applyTables(pool);
}

async function applyTables(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS users (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      email text NOT NULL UNIQUE,
      name text NOT NULL,
      password_hash text NOT NULL,
      role text NOT NULL CHECK (role IN ('owner','member','viewer')),
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS sessions (
      token text PRIMARY KEY,
      user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id uuid NOT NULL REFERENCES teams(id),
      owner_id uuid NOT NULL REFERENCES users(id),
      title text NOT NULL,
      status text NOT NULL CHECK (status IN ('draft','in_progress','sealing','completed','declined','voided')),
      time_zone text NOT NULL DEFAULT 'UTC',
      page_count integer NOT NULL,
      original_sha256 text NOT NULL,
      completed_sha256 text,
      version integer NOT NULL DEFAULT 0,
      current_order integer,
      reminder_available_at timestamptz,
      void_reason text,
      voided_by text,
      declined_by_recipient_id uuid,
      declined_by_name text,
      send_token text,
      reminder_token text,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS recipients (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      name text NOT NULL,
      email text NOT NULL,
      "order" integer NOT NULL,
      status text NOT NULL CHECK (status IN ('waiting','invited','viewed','signed','declined','expired')),
      delivery text CHECK (delivery IN ('sent','held')),
      link_hash text,
      link_expires_at timestamptz,
      turn_started_at timestamptz,
      signed_at timestamptz,
      decline_reason text,
      binding boolean NOT NULL DEFAULT true
    );
    CREATE TABLE IF NOT EXISTS fields (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      kind text NOT NULL CHECK (kind IN ('signature','initials','date','text')),
      label text NOT NULL,
      required boolean NOT NULL DEFAULT true,
      page integer NOT NULL,
      x double precision NOT NULL,
      y double precision NOT NULL,
      w double precision NOT NULL,
      h double precision NOT NULL,
      value text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      seq bigint NOT NULL,
      document_id uuid NOT NULL,
      type text NOT NULL,
      actor text NOT NULL,
      recipient_id uuid,
      at timestamptz NOT NULL,
      prev_hash text NOT NULL,
      hash text NOT NULL,
      PRIMARY KEY (document_id, seq)
    );
    CREATE TABLE IF NOT EXISTS templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      team_id uuid NOT NULL REFERENCES teams(id),
      owner_id uuid NOT NULL REFERENCES users(id),
      name text NOT NULL,
      status text NOT NULL CHECK (status IN ('draft','shared','retired')),
      page_count integer NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS template_fields (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
      signer integer NOT NULL,
      kind text NOT NULL,
      label text NOT NULL,
      required boolean NOT NULL DEFAULT true,
      page integer NOT NULL,
      x double precision NOT NULL,
      y double precision NOT NULL,
      w double precision NOT NULL,
      h double precision NOT NULL
    );
    CREATE TABLE IF NOT EXISTS idempotency (
      key text NOT NULL,
      document_id uuid NOT NULL,
      status integer NOT NULL,
      body text NOT NULL,
      PRIMARY KEY (document_id, key)
    );
    CREATE TABLE IF NOT EXISTS link_tokens (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
      document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
      token text NOT NULL UNIQUE,
      created_at timestamptz NOT NULL DEFAULT now(),
      superseded boolean NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_link_tokens_recipient ON link_tokens(recipient_id);
    CREATE TABLE IF NOT EXISTS held_emails (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid,
      to_email text NOT NULL,
      subject text NOT NULL,
      body text NOT NULL,
      from_name text NOT NULL,
      from_address text NOT NULL,
      public_url text NOT NULL DEFAULT '',
      kind text NOT NULL,
      held_at timestamptz NOT NULL DEFAULT now(),
      last_attempt timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      delivered boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS seal_jobs (
      document_id uuid PRIMARY KEY,
      last_attempt timestamptz,
      attempts integer NOT NULL DEFAULT 0,
      sealed boolean NOT NULL DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS strokes (
      field_id uuid PRIMARY KEY REFERENCES fields(id) ON DELETE CASCADE,
      data jsonb NOT NULL
    );
    CREATE TABLE IF NOT EXISTS template_originals (
      template_id uuid PRIMARY KEY,
      stored boolean NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS idx_recipients_doc ON recipients(document_id);
    CREATE INDEX IF NOT EXISTS idx_fields_doc ON fields(document_id);
    CREATE INDEX IF NOT EXISTS idx_audit_doc ON audit_events(document_id, seq);
    CREATE INDEX IF NOT EXISTS idx_docs_team ON documents(team_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_held_undelivered ON held_emails(delivered) WHERE delivered = false;
  `);
}
