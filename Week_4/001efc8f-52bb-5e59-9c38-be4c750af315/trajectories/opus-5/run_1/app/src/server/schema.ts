import { pool } from './db';

const SCHEMA_SQL = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  handle text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_key ON users (workspace_id, lower(handle));

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  invited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  accepted_at timestamptz
);

CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  private boolean NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_name_key ON channels (workspace_id, name);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_message_id uuid,
  text text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  sent_at timestamptz NOT NULL,
  edited_at timestamptz,
  thread_root_id uuid,
  quoted_message_id uuid,
  counted boolean NOT NULL DEFAULT true,
  deleted boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id_key
  ON messages (author_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_channel_sent ON messages (channel_id, sent_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_root_id) WHERE thread_root_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS messages_author_sent ON messages (author_id, sent_at DESC);

CREATE TABLE IF NOT EXISTS message_versions (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  version integer NOT NULL,
  text text NOT NULL,
  edited_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, version)
);

CREATE TABLE IF NOT EXISTS receipts (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delivered_at timestamptz,
  PRIMARY KEY (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version integer NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, user_id, version)
);

CREATE TABLE IF NOT EXISTS mentions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  thread_root_id uuid,
  created_at timestamptz NOT NULL,
  handled_period text,
  handled_at timestamptz,
  UNIQUE (message_id, user_id)
);

CREATE TABLE IF NOT EXISTS pins (
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  pinned_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pinned_at timestamptz NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  message_id uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  uploaded_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  source_hash text NOT NULL,
  position integer NOT NULL,
  uploaded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_gallery ON attachments (channel_id, uploaded_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS removal_queue (
  object_key text PRIMARY KEY,
  queued_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text text NOT NULL,
  state text NOT NULL,
  repeat_rule text NOT NULL,
  local_date text NOT NULL,
  local_time text NOT NULL,
  next_fire_at timestamptz,
  fired_count integer NOT NULL DEFAULT 0,
  last_message_id uuid,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS outbound_emails (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  dedupe_key text NOT NULL UNIQUE,
  to_address text NOT NULL,
  to_name text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS digest_deliveries (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  period text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, period)
);

CREATE TABLE IF NOT EXISTS digest_runs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period text NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, period)
);

CREATE TABLE IF NOT EXISTS event_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id uuid,
  target_user_id uuid,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS event_log_created ON event_log (created_at);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA_SQL);
}
