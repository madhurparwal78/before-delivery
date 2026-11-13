import { pool } from './pool.ts';

const STATEMENTS: string[] = [
  `CREATE TABLE IF NOT EXISTS teams (
     id uuid PRIMARY KEY,
     name text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS users (
     id uuid PRIMARY KEY,
     team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     email text NOT NULL UNIQUE,
     name text NOT NULL,
     password_hash text NOT NULL,
     role text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS sessions (
     id uuid PRIMARY KEY,
     user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS documents (
     id uuid PRIMARY KEY,
     team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     title text NOT NULL,
     status text NOT NULL,
     time_zone text NOT NULL DEFAULT 'UTC',
     page_count integer NOT NULL,
     original_sha256 text NOT NULL,
     completed_sha256 text,
     version integer NOT NULL DEFAULT 1,
     reminder_available_at timestamptz,
     declined_by uuid,
     decline_reason text,
     voided_by uuid,
     void_reason text,
     seal_failed_at timestamptz,
     seal_lock_at timestamptz,
     created_at timestamptz NOT NULL DEFAULT now(),
     updated_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS documents_team_idx ON documents (team_id, updated_at DESC)`,
  `CREATE TABLE IF NOT EXISTS recipients (
     id uuid PRIMARY KEY,
     document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     name text NOT NULL,
     email text NOT NULL,
     order_index integer NOT NULL,
     status text NOT NULL DEFAULT 'waiting',
     delivery text,
     signed_at timestamptz,
     decline_reason text,
     binding boolean NOT NULL DEFAULT true,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS recipients_document_idx ON recipients (document_id, order_index)`,
  `CREATE TABLE IF NOT EXISTS links (
     id uuid PRIMARY KEY,
     document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
     token_hash text NOT NULL UNIQUE,
     issued_at timestamptz NOT NULL,
     expires_at timestamptz NOT NULL,
     active boolean NOT NULL DEFAULT true
   )`,
  `CREATE INDEX IF NOT EXISTS links_recipient_idx ON links (recipient_id)`,
  `CREATE TABLE IF NOT EXISTS fields (
     id uuid PRIMARY KEY,
     document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     recipient_id uuid NOT NULL REFERENCES recipients(id) ON DELETE CASCADE,
     kind text NOT NULL,
     label text NOT NULL,
     required boolean NOT NULL DEFAULT true,
     page integer NOT NULL,
     x numeric(6,4) NOT NULL,
     y numeric(6,4) NOT NULL,
     w numeric(6,4) NOT NULL,
     h numeric(6,4) NOT NULL,
     value text,
     strokes jsonb,
     seq bigserial NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS fields_document_idx ON fields (document_id, seq)`,
  `CREATE TABLE IF NOT EXISTS audit_events (
     document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     seq integer NOT NULL,
     type text NOT NULL,
     actor text NOT NULL,
     recipient_id uuid,
     at_text text NOT NULL,
     prev_hash text NOT NULL,
     hash text NOT NULL,
     PRIMARY KEY (document_id, seq)
   )`,
  `CREATE TABLE IF NOT EXISTS templates (
     id uuid PRIMARY KEY,
     team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
     name text NOT NULL,
     status text NOT NULL,
     page_count integer NOT NULL,
     signer_count integer NOT NULL,
     original_sha256 text NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS template_fields (
     id uuid PRIMARY KEY,
     template_id uuid NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
     signer integer NOT NULL,
     kind text NOT NULL,
     label text NOT NULL,
     required boolean NOT NULL,
     page integer NOT NULL,
     x numeric(6,4) NOT NULL,
     y numeric(6,4) NOT NULL,
     w numeric(6,4) NOT NULL,
     h numeric(6,4) NOT NULL,
     seq bigserial NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency_keys (
     key text PRIMARY KEY,
     document_id uuid NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
     status integer NOT NULL,
     body jsonb NOT NULL,
     created_at timestamptz NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS mail_outbox (
     id uuid PRIMARY KEY,
     document_id uuid REFERENCES documents(id) ON DELETE CASCADE,
     recipient_id uuid REFERENCES recipients(id) ON DELETE CASCADE,
     kind text NOT NULL,
     to_email text NOT NULL,
     from_header text NOT NULL,
     subject text NOT NULL,
     body text NOT NULL,
     state text NOT NULL,
     held_at timestamptz NOT NULL,
     last_attempt_at timestamptz NOT NULL,
     delivered_at timestamptz,
     lock_at timestamptz
   )`,
  `CREATE INDEX IF NOT EXISTS mail_outbox_state_idx ON mail_outbox (state, last_attempt_at)`,
];

export const applySchema = async (): Promise<void> => {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock(7731402)');
    for (const statement of STATEMENTS) {
      await client.query(statement);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock(7731402)').catch(() => undefined);
    client.release();
  }
};
