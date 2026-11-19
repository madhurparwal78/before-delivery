CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  handle text NOT NULL,
  email text NOT NULL UNIQUE,
  role text NOT NULL,
  status text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS users_workspace_idx ON users (workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  kind text NOT NULL,
  private boolean NOT NULL
);
CREATE INDEX IF NOT EXISTS channels_workspace_idx ON channels (workspace_id);

CREATE TABLE IF NOT EXISTS memberships (
  channel_id uuid NOT NULL REFERENCES channels(id),
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user_idx ON memberships (user_id);

CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  client_message_id text NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  text text NOT NULL,
  version integer NOT NULL,
  sent_at timestamptz NOT NULL,
  edited_at timestamptz,
  thread_root_id uuid,
  quoted_message_id uuid,
  deleted boolean NOT NULL DEFAULT false
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_client_id_idx ON messages (author_id, channel_id, client_message_id);
CREATE INDEX IF NOT EXISTS messages_channel_sent_idx ON messages (channel_id, sent_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_root_id);

CREATE TABLE IF NOT EXISTS message_versions (
  message_id uuid NOT NULL REFERENCES messages(id),
  version integer NOT NULL,
  text text NOT NULL,
  edited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, version)
);

CREATE TABLE IF NOT EXISTS receipts (
  message_id uuid NOT NULL REFERENCES messages(id),
  user_id uuid NOT NULL REFERENCES users(id),
  delivered_at timestamptz,
  PRIMARY KEY (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS receipts_user_idx ON receipts (user_id);

CREATE TABLE IF NOT EXISTS message_reads (
  message_id uuid NOT NULL REFERENCES messages(id),
  user_id uuid NOT NULL REFERENCES users(id),
  version integer NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, user_id, version)
);

CREATE TABLE IF NOT EXISTS mentions (
  id bigserial PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id),
  channel_id uuid NOT NULL REFERENCES channels(id),
  mentioned_user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  digested_at timestamptz
);
CREATE INDEX IF NOT EXISTS mentions_user_idx ON mentions (mentioned_user_id);

CREATE TABLE IF NOT EXISTS pins (
  channel_id uuid NOT NULL REFERENCES channels(id),
  message_id uuid NOT NULL REFERENCES messages(id),
  pinned_by uuid NOT NULL REFERENCES users(id),
  pinned_at timestamptz NOT NULL,
  PRIMARY KEY (channel_id, message_id)
);

CREATE TABLE IF NOT EXISTS scheduled_posts (
  id uuid PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  created_by uuid NOT NULL REFERENCES users(id),
  text text NOT NULL,
  state text NOT NULL,
  repeat text NOT NULL,
  local_date text NOT NULL,
  local_time text NOT NULL,
  next_fire_at timestamptz,
  last_fired_at timestamptz,
  fired_count integer NOT NULL DEFAULT 0,
  last_message_id uuid REFERENCES messages(id)
);
CREATE INDEX IF NOT EXISTS scheduled_posts_due_idx ON scheduled_posts (next_fire_at) WHERE state = 'scheduled';

CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL REFERENCES messages(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  channel_id uuid NOT NULL REFERENCES channels(id),
  filename text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  original_key text NOT NULL,
  thumb_key text NOT NULL,
  state text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_message_idx ON attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_channel_idx ON attachments (channel_id, uploaded_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS removal_queue (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  message_id uuid NOT NULL,
  attachment_id uuid NOT NULL,
  object_key text NOT NULL,
  queued_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text
);
CREATE UNIQUE INDEX IF NOT EXISTS removal_queue_key_idx ON removal_queue (object_key);

CREATE TABLE IF NOT EXISTS event_log (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  user_id uuid,
  channel_id uuid,
  type text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS event_log_user_idx ON event_log (id, workspace_id, user_id);

CREATE TABLE IF NOT EXISTS mail_ledger (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  key text NOT NULL,
  payload jsonb NOT NULL,
  state text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS mail_ledger_key_idx ON mail_ledger (kind, key);

CREATE TABLE IF NOT EXISTS digest_periods (
  user_id uuid NOT NULL REFERENCES users(id),
  period_key text NOT NULL,
  handled_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, period_key)
);
