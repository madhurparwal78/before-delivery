export const schemaSql = `
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  seat_limit INT NOT NULL,
  account_external_key TEXT,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_states (
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  seq INT NOT NULL,
  effective_from TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  working_weekdays INT[] NOT NULL,
  holidays JSONB NOT NULL,
  cycle_anchor TEXT NOT NULL,
  PRIMARY KEY (workspace_id, seq)
);

CREATE TABLE IF NOT EXISTS people (
  id UUID PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  handle TEXT,
  role TEXT,
  password_hex TEXT NOT NULL,
  removed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS people_email_lower_idx ON people (lower(email));
CREATE INDEX IF NOT EXISTS people_workspace_idx ON people (workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_person_idx ON sessions (person_id);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  name TEXT NOT NULL,
  seq INT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS projects_ws_key_idx ON projects (workspace_id, key);

CREATE TABLE IF NOT EXISTS project_guests (
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS issues (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number INT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  status TEXT NOT NULL,
  assignee_id UUID REFERENCES people(id),
  parent_id UUID REFERENCES issues(id),
  cycle_number INT,
  due_date TEXT,
  closed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS issues_project_number_idx ON issues (project_id, number);
CREATE INDEX IF NOT EXISTS issues_workspace_idx ON issues (workspace_id);
CREATE INDEX IF NOT EXISTS issues_parent_idx ON issues (parent_id);

CREATE TABLE IF NOT EXISTS channels (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS channels_ws_name_idx ON channels (workspace_id, name);

CREATE TABLE IF NOT EXISTS channel_members (
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (channel_id, person_id)
);
CREATE INDEX IF NOT EXISTS channel_members_person_idx ON channel_members (person_id);

CREATE TABLE IF NOT EXISTS messages (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES people(id),
  body TEXT NOT NULL,
  thread_root_id BIGINT REFERENCES messages(id) ON DELETE CASCADE,
  client_key TEXT,
  mentions UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS messages_channel_idx ON messages (channel_id, id);
CREATE INDEX IF NOT EXISTS messages_thread_idx ON messages (thread_root_id);
CREATE INDEX IF NOT EXISTS messages_workspace_idx ON messages (workspace_id);
CREATE INDEX IF NOT EXISTS messages_client_key_idx ON messages (author_id, client_key);

CREATE TABLE IF NOT EXISTS read_markers (
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  last_read BIGINT NOT NULL DEFAULT 0,
  PRIMARY KEY (person_id, scope, scope_id)
);

CREATE TABLE IF NOT EXISTS docs (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  version INT NOT NULL,
  updated_by UUID REFERENCES people(id),
  updated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS doc_versions (
  doc_id UUID NOT NULL REFERENCES docs(id) ON DELETE CASCADE,
  version INT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL,
  saved_by UUID REFERENCES people(id),
  PRIMARY KEY (doc_id, version)
);

CREATE TABLE IF NOT EXISTS rooms (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  w INT NOT NULL,
  h INT NOT NULL,
  seq INT NOT NULL
);

CREATE TABLE IF NOT EXISTS room_occupants (
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  PRIMARY KEY (room_id, person_id)
);
CREATE INDEX IF NOT EXISTS room_occupants_person_idx ON room_occupants (person_id);

CREATE TABLE IF NOT EXISTS knocks (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  answered_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS knocks_room_idx ON knocks (room_id, created_at);

CREATE TABLE IF NOT EXISTS invites (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  project_ids UUID[] NOT NULL DEFAULT '{}',
  channel_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_ws_email_idx ON invites (workspace_id, lower(email));

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  workspace_id UUID NOT NULL,
  name TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS events_workspace_idx ON events (workspace_id, id);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT NOT NULL,
  person_id UUID NOT NULL,
  endpoint TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (person_id, endpoint, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  kind TEXT NOT NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  ref_table TEXT,
  ref_id TEXT,
  status TEXT NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  sent_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS outbox_unsent_idx ON outbox (status, created_at);
ALTER TABLE outbox ADD COLUMN IF NOT EXISTS last_attempt_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS attachment_deletions (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  parent_type TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  size BIGINT NOT NULL,
  content_type TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS attachments_parent_idx ON attachments (parent_type, parent_id);
CREATE INDEX IF NOT EXISTS attachments_workspace_idx ON attachments (workspace_id);

CREATE TABLE IF NOT EXISTS typing (
  person_id UUID NOT NULL,
  channel_id UUID NOT NULL,
  last_signal TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (person_id, channel_id)
);

CREATE TABLE IF NOT EXISTS presence (
  person_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  status TEXT NOT NULL,
  last_heartbeat TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS stream_state (
  person_id UUID PRIMARY KEY,
  workspace_id UUID NOT NULL,
  last_disconnect TIMESTAMPTZ,
  stream_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS finished_cycles (
  workspace_id UUID NOT NULL,
  number INT NOT NULL,
  record JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, number)
);

CREATE TABLE IF NOT EXISTS digests (
  workspace_id UUID NOT NULL,
  person_id UUID NOT NULL,
  date TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (workspace_id, person_id, date)
);

CREATE TABLE IF NOT EXISTS app_state (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`;
