// The schema, applied idempotently every time the app serves. Instants are epoch milliseconds
// taken from the process clock; dates are workspace-calendar `date`s.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  seat_limit integer NOT NULL,
  seats_read_at bigint NOT NULL DEFAULT 0,
  scheduled_limit integer,
  scheduled_on date,
  kb_account_id text,
  kb_subscription_id text,
  pruned_through bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS calendar_saves (
  seq bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  effective_date date NOT NULL,
  time_zone text NOT NULL,
  working_weekdays integer[] NOT NULL,
  holidays jsonb NOT NULL,
  cycle_anchor date NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_saves_ws ON calendar_saves (workspace_id, seq);
CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  handle text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  workspace_id uuid REFERENCES workspaces(id),
  role text,
  last_active_at bigint NOT NULL DEFAULT 0,
  presence text NOT NULL DEFAULT 'active',
  streams_closed_at bigint,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  key text NOT NULL,
  name text NOT NULL,
  next_number integer NOT NULL DEFAULT 1,
  UNIQUE (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS project_guests (
  project_id uuid NOT NULL REFERENCES projects(id),
  person_id uuid NOT NULL REFERENCES people(id),
  PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS issues (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  number integer NOT NULL,
  key text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  status text NOT NULL,
  assignee_id uuid REFERENCES people(id),
  parent_id uuid REFERENCES issues(id),
  planned_cycle integer,
  due_date date,
  closed_at bigint,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  UNIQUE (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS cycle_records (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  number integer NOT NULL,
  record jsonb NOT NULL,
  PRIMARY KEY (workspace_id, number)
);
CREATE TABLE IF NOT EXISTS channels (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS channel_members (
  channel_id uuid NOT NULL REFERENCES channels(id),
  person_id uuid NOT NULL REFERENCES people(id),
  PRIMARY KEY (channel_id, person_id)
);
CREATE TABLE IF NOT EXISTS messages (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  channel_id uuid NOT NULL REFERENCES channels(id),
  author_id uuid NOT NULL REFERENCES people(id),
  body text NOT NULL,
  thread_root_id bigint REFERENCES messages(id) ON DELETE CASCADE,
  client_key text,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS deleted_messages (
  id bigint PRIMARY KEY,
  channel_id uuid NOT NULL REFERENCES channels(id),
  thread_root_id bigint
);
CREATE INDEX IF NOT EXISTS messages_channel ON messages (channel_id, id);
CREATE INDEX IF NOT EXISTS messages_root ON messages (thread_root_id, id);
CREATE TABLE IF NOT EXISTS message_mentions (
  message_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id),
  PRIMARY KEY (message_id, person_id)
);
CREATE TABLE IF NOT EXISTS read_markers (
  person_id uuid NOT NULL REFERENCES people(id),
  channel_id uuid NOT NULL REFERENCES channels(id),
  up_to bigint NOT NULL,
  PRIMARY KEY (person_id, channel_id)
);
CREATE TABLE IF NOT EXISTS thread_markers (
  person_id uuid NOT NULL REFERENCES people(id),
  root_id bigint NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
  up_to bigint NOT NULL,
  PRIMARY KEY (person_id, root_id)
);
CREATE TABLE IF NOT EXISTS typing (
  channel_id uuid NOT NULL REFERENCES channels(id),
  person_id uuid NOT NULL REFERENCES people(id),
  last_at bigint NOT NULL,
  PRIMARY KEY (channel_id, person_id)
);
CREATE TABLE IF NOT EXISTS docs (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  project_id uuid NOT NULL REFERENCES projects(id),
  title text NOT NULL,
  body text NOT NULL,
  version integer NOT NULL,
  updated_by uuid NOT NULL REFERENCES people(id),
  updated_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS doc_versions (
  doc_id uuid NOT NULL REFERENCES docs(id),
  version integer NOT NULL,
  title text NOT NULL,
  body text NOT NULL,
  saved_by uuid NOT NULL REFERENCES people(id),
  saved_at bigint NOT NULL,
  PRIMARY KEY (doc_id, version)
);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  issue_id uuid REFERENCES issues(id) ON DELETE CASCADE,
  message_id bigint REFERENCES messages(id) ON DELETE CASCADE,
  doc_id uuid REFERENCES docs(id) ON DELETE CASCADE,
  filename text NOT NULL,
  size bigint NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL,
  created_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS attachment_deletions (
  id bigserial PRIMARY KEY,
  object_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  kind text NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  w integer NOT NULL,
  h integer NOT NULL,
  position integer NOT NULL
);
CREATE TABLE IF NOT EXISTS room_occupants (
  person_id uuid PRIMARY KEY REFERENCES people(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  joined_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS knocks (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  person_id uuid NOT NULL REFERENCES people(id),
  status text NOT NULL,
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS knocks_room ON knocks (room_id, created_at);
CREATE TABLE IF NOT EXISTS stream_leases (
  id uuid PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  seen_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  email_key text NOT NULL,
  role text NOT NULL,
  project_ids uuid[] NOT NULL,
  channel_ids uuid[] NOT NULL,
  status text NOT NULL,
  invited_by uuid NOT NULL REFERENCES people(id),
  created_at bigint NOT NULL,
  expires_at bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  person_id uuid NOT NULL,
  endpoint text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  body text,
  created_at bigint NOT NULL,
  PRIMARY KEY (person_id, endpoint, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL,
  recipient_id uuid,
  recipient_email text NOT NULL,
  invite_id uuid,
  message_id bigint,
  subject text NOT NULL,
  body text NOT NULL,
  created_at bigint NOT NULL,
  sent_at bigint
);
CREATE INDEX IF NOT EXISTS outbox_held ON outbox (workspace_id) WHERE sent_at IS NULL;
CREATE TABLE IF NOT EXISTS digest_runs (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  day date NOT NULL,
  PRIMARY KEY (workspace_id, day)
);
CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  channel_id uuid,
  project_id uuid,
  recipients uuid[],
  sessions text[],
  data jsonb NOT NULL,
  created_at bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS events_ws ON events (workspace_id, id);
`;
