import { LOCK, lock, tx } from "./db.js";
import { seed } from "./seed.js";

// Applied on every serve under an advisory lock, so several app processes sharing one database
// never race. Every statement is idempotent.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  time_zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  handle text NOT NULL,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('dispatcher','field_technician','crew_lead','ops_manager')),
  status text NOT NULL CHECK (status IN ('active','invited','deactivated')),
  password_hash text,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_handle ON users (workspace_id, lower(handle));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions (user_id);
CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  invited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  accepted_at timestamptz,
  email_sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS invites_unsent ON invites (created_at) WHERE email_sent_at IS NULL;
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('broadcast','crew')),
  private boolean NOT NULL,
  UNIQUE (workspace_id, name)
);
CREATE TABLE IF NOT EXISTS memberships (
  channel_id uuid NOT NULL REFERENCES channels(id),
  user_id uuid NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL,
  joined_event_id bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (channel_id, user_id)
);
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id);
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL REFERENCES channels(id),
  author_id uuid NOT NULL REFERENCES users(id),
  client_message_id uuid,
  via_send boolean NOT NULL,
  text text NOT NULL,
  version integer NOT NULL,
  sent_at timestamptz NOT NULL,
  edited_at timestamptz,
  editable_until timestamptz NOT NULL,
  thread_root_id uuid,
  quoted_message_id uuid,
  pinned_by uuid REFERENCES users(id),
  pinned_at timestamptz,
  deleted_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_history ON messages (channel_id, sent_at DESC, (id::text) DESC) WHERE thread_root_id IS NULL;
CREATE INDEX IF NOT EXISTS messages_thread ON messages (thread_root_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS messages_author ON messages (author_id, sent_at DESC);
CREATE TABLE IF NOT EXISTS send_ids (
  author_id uuid NOT NULL,
  client_message_id uuid NOT NULL,
  message_id uuid NOT NULL,
  fingerprint text NOT NULL,
  PRIMARY KEY (author_id, client_message_id)
);
CREATE TABLE IF NOT EXISTS message_versions (
  message_id uuid NOT NULL,
  version integer NOT NULL,
  text text NOT NULL,
  edited_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, version)
);
CREATE TABLE IF NOT EXISTS deliveries (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  delivered_at timestamptz,
  PRIMARY KEY (message_id, user_id)
);
CREATE TABLE IF NOT EXISTS reads (
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  version integer NOT NULL,
  read_at timestamptz NOT NULL,
  PRIMARY KEY (message_id, user_id, version)
);
CREATE INDEX IF NOT EXISTS reads_user ON reads (user_id, message_id);
CREATE TABLE IF NOT EXISTS mentions (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL,
  user_id uuid NOT NULL,
  handled_at timestamptz,
  UNIQUE (message_id, user_id)
);
CREATE INDEX IF NOT EXISTS mentions_open ON mentions (user_id) WHERE handled_at IS NULL;
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  message_id uuid NOT NULL,
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL,
  position integer NOT NULL,
  filename text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  upload_sha256 text NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES users(id),
  uploaded_at timestamptz NOT NULL,
  state text NOT NULL CHECK (state IN ('stored','removal_queued','removed'))
);
CREATE INDEX IF NOT EXISTS attachments_message ON attachments (message_id);
CREATE INDEX IF NOT EXISTS attachments_gallery ON attachments (channel_id, uploaded_at DESC, (id::text) DESC) WHERE state = 'stored';
CREATE TABLE IF NOT EXISTS removal_queue (
  object_key text PRIMARY KEY,
  attachment_id uuid,
  queued_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_posts (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL,
  channel_id uuid NOT NULL REFERENCES channels(id),
  author_id uuid NOT NULL REFERENCES users(id),
  text text NOT NULL,
  repeat text NOT NULL CHECK (repeat IN ('none','weekly')),
  local_date date NOT NULL,
  local_time text NOT NULL,
  time_zone text NOT NULL,
  state text NOT NULL CHECK (state IN ('scheduled','firing','sent','cancelled')),
  next_fire_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS scheduled_due ON scheduled_posts (next_fire_at) WHERE state = 'scheduled';
CREATE TABLE IF NOT EXISTS scheduled_fires (
  scheduled_id uuid NOT NULL REFERENCES scheduled_posts(id),
  occurrence_at timestamptz NOT NULL,
  message_id uuid NOT NULL,
  fired_at timestamptz NOT NULL,
  PRIMARY KEY (scheduled_id, occurrence_at)
);
CREATE TABLE IF NOT EXISTS digest_runs (
  workspace_id uuid NOT NULL,
  period text NOT NULL,
  completed_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, period)
);
CREATE TABLE IF NOT EXISTS digests (
  user_id uuid NOT NULL,
  period text NOT NULL,
  sent_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, period)
);
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL,
  channel_id uuid,
  user_id uuid,
  name text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS events_created ON events (created_at);
`;

export async function migrate(): Promise<void> {
  await tx(async (client) => {
    await lock(client, LOCK.schema);
    await client.query(SCHEMA);
    await seed(client);
  });
}
