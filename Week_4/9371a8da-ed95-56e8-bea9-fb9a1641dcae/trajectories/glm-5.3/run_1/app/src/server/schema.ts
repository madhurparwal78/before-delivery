export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  display_name text NOT NULL,
  handle text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  template text NOT NULL,
  revision int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS memberships (
  project_id text NOT NULL REFERENCES projects(id),
  user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  path text NOT NULL,
  kind text NOT NULL,
  revision int NOT NULL,
  size int NOT NULL,
  content_type text,
  sha256 text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, path, deleted_at)
);

CREATE TABLE IF NOT EXISTS file_versions (
  file_id text NOT NULL REFERENCES files(id),
  revision int NOT NULL,
  content bytea NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id, revision)
);

CREATE TABLE IF NOT EXISTS suggestions (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  file_id text NOT NULL REFERENCES files(id),
  from_pos int,
  to_pos int,
  deleted text NOT NULL,
  inserted text NOT NULL,
  status text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  author_handle text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_by_id text,
  resolved_by_name text,
  resolved_by_handle text,
  resolved_at timestamptz,
  orphaned_at timestamptz
);

CREATE TABLE IF NOT EXISTS threads (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  file_id text NOT NULL REFERENCES files(id),
  from_pos int,
  to_pos int,
  quote text NOT NULL,
  status text NOT NULL,
  orphaned boolean NOT NULL DEFAULT false,
  resolved_by_id text,
  resolved_by_name text,
  resolved_by_handle text,
  orphaned_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES threads(id),
  author_id text NOT NULL,
  author_name text NOT NULL,
  author_handle text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  project_id text NOT NULL REFERENCES projects(id),
  revision int NOT NULL,
  kind text NOT NULL,
  summary text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  actor_handle text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, revision)
);

CREATE TABLE IF NOT EXISTS labels (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  name text NOT NULL,
  name_lower text NOT NULL,
  revision int NOT NULL,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_by_handle text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name_lower)
);

CREATE TABLE IF NOT EXISTS project_revisions (
  project_id text NOT NULL REFERENCES projects(id),
  revision int NOT NULL,
  file_id text NOT NULL,
  path text NOT NULL,
  kind text NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  PRIMARY KEY (project_id, revision, file_id)
);

CREATE TABLE IF NOT EXISTS citation_reports (
  project_id text NOT NULL,
  revision int NOT NULL,
  check_id text NOT NULL,
  report jsonb NOT NULL,
  PRIMARY KEY (project_id, revision)
);

CREATE TABLE IF NOT EXISTS saved_saves (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  file_id text NOT NULL,
  key text NOT NULL,
  status int NOT NULL,
  body bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, file_id, key)
);

CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  email text NOT NULL,
  email_lower text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  token text NOT NULL,
  revoked_at timestamptz,
  accepted_at timestamptz
);

CREATE TABLE IF NOT EXISTS share_links (
  project_id text PRIMARY KEY REFERENCES projects(id),
  token text NOT NULL,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id),
  revision int NOT NULL,
  size int NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, revision)
);

CREATE TABLE IF NOT EXISTS mention_emails (
  id text PRIMARY KEY,
  project_id text NOT NULL,
  thread_id text NOT NULL,
  comment_id text NOT NULL,
  recipient_id text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  next_attempt_at timestamptz NOT NULL,
  claimed_at timestamptz,
  attempts int NOT NULL DEFAULT 0,
  UNIQUE (comment_id, recipient_id)
);
CREATE INDEX IF NOT EXISTS mention_emails_due ON mention_emails (state, next_attempt_at);
`;
