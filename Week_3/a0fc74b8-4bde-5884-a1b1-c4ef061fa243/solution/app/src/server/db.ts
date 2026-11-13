import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

pool.on("error", () => {
  /* idle clients that lose their connection are discarded by the pool */
});

export type Db = Pick<pg.PoolClient, "query">;

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('owner', 'member', 'viewer'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS documents (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'in_progress', 'sealing', 'completed', 'declined', 'voided')),
  time_zone text NOT NULL DEFAULT 'UTC',
  page_count int NOT NULL,
  page_sizes jsonb NOT NULL,
  original_sha256 text NOT NULL,
  completed_sha256 text,
  version int NOT NULL DEFAULT 1,
  current_order int,
  reminder_available_at timestamptz,
  reminder_expiry_pushed boolean NOT NULL DEFAULT true,
  seal_next_attempt_at timestamptz,
  voided_by uuid REFERENCES users(id),
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS documents_team_updated ON documents (team_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS recipients (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  signing_order int NOT NULL,
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting', 'invited', 'viewed', 'signed', 'declined', 'expired')),
  delivery text CHECK (delivery IN ('sent', 'held')),
  link_expires_at timestamptz,
  signed_at timestamptz,
  decline_reason text
);
CREATE INDEX IF NOT EXISTS recipients_document ON recipients (document_id, signing_order);
CREATE TABLE IF NOT EXISTS links (
  token_hash text PRIMARY KEY,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  replaced boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS links_recipient ON links (recipient_id);
CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('signature', 'initials', 'date', 'text')),
  label text NOT NULL,
  required boolean NOT NULL DEFAULT true,
  page int NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  w double precision NOT NULL,
  h double precision NOT NULL,
  value text,
  strokes jsonb,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS fields_document ON fields (document_id, created_seq);
CREATE TABLE IF NOT EXISTS audit_events (
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  seq int NOT NULL,
  type text NOT NULL,
  actor text NOT NULL,
  recipient_id uuid,
  at timestamptz NOT NULL,
  prev_hash text NOT NULL,
  hash text NOT NULL,
  PRIMARY KEY (document_id, seq)
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY,
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  status int NOT NULL,
  body jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  id uuid PRIMARY KEY,
  team_id uuid NOT NULL REFERENCES teams(id),
  name text NOT NULL,
  status text NOT NULL CHECK (status IN ('draft', 'shared', 'retired')),
  page_count int NOT NULL,
  page_sizes jsonb NOT NULL,
  original_sha256 text NOT NULL,
  signer_count int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS template_fields (
  id uuid PRIMARY KEY,
  template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  signer int NOT NULL,
  kind text NOT NULL,
  label text NOT NULL,
  required boolean NOT NULL,
  page int NOT NULL,
  x double precision NOT NULL,
  y double precision NOT NULL,
  w double precision NOT NULL,
  h double precision NOT NULL,
  created_seq bigserial
);
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('invitation', 'new_link', 'decline_notice', 'void_notice', 'completed')),
  document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  recipient_id uuid REFERENCES recipients(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  link_token text,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'sent')),
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt_at) WHERE status = 'held';
`;

const SCHEMA_LOCK = 727001;
const WAIT_SECONDS = 60;

export async function connectAndMigrate(): Promise<void> {
  const deadline = Date.now() + WAIT_SECONDS * 1000;
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
        try {
          await client.query(SCHEMA);
        } finally {
          await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
        }
      } finally {
        client.release();
      }
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export const LIVE_CHANNEL = "undersign_live";
