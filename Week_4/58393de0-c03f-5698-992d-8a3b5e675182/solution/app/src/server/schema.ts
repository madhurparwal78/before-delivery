/** Applied on every start; every statement is safe to repeat and never drops data. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  display_name text NOT NULL,
  email text,
  password_hash text,
  email_verified boolean NOT NULL,
  classroom_id text,
  nickname text,
  nickname_key text,
  verification_sent_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS accounts_email_unique ON accounts (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS accounts_nickname_unique ON accounts (classroom_id, nickname_key) WHERE kind = 'student';
CREATE INDEX IF NOT EXISTS accounts_classroom ON accounts (classroom_id);

CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS verification_tokens_account ON verification_tokens (account_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id text,
  pending_classroom_id text,
  removed_message text,
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_account ON sessions (account_id);

CREATE TABLE IF NOT EXISTS classrooms (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  name text NOT NULL,
  time_zone text NOT NULL,
  join_code text NOT NULL,
  join_opens_local text NOT NULL,
  join_closes_local text NOT NULL,
  hand_in_local text NOT NULL,
  join_opens_at timestamptz NOT NULL,
  join_closes_at timestamptz NOT NULL,
  hand_in_at timestamptz NOT NULL,
  archived_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS classrooms_join_code_unique ON classrooms (join_code) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS classrooms_owner ON classrooms (owner_id);

CREATE TABLE IF NOT EXISTS classroom_educators (
  classroom_id text NOT NULL REFERENCES classrooms (id) ON DELETE CASCADE,
  educator_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL,
  PRIMARY KEY (classroom_id, educator_id)
);
CREATE INDEX IF NOT EXISTS classroom_educators_educator ON classroom_educators (educator_id);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  classroom_id text,
  kind text NOT NULL,
  name text NOT NULL,
  revision integer NOT NULL,
  saved_at timestamptz NOT NULL,
  handed_in_at timestamptz
);
CREATE INDEX IF NOT EXISTS projects_owner ON projects (owner_id);

CREATE TABLE IF NOT EXISTS revisions (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  revision integer NOT NULL,
  object_key text NOT NULL,
  saved_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, revision)
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  account_id text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, account_id, key)
);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES accounts (id) ON DELETE CASCADE,
  project_id text REFERENCES projects (id) ON DELETE SET NULL,
  file_name text NOT NULL,
  format text NOT NULL,
  unit text NOT NULL,
  bytes integer NOT NULL,
  triangle_count integer,
  bbox jsonb,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS exports_owner ON exports (owner_id);

CREATE TABLE IF NOT EXISTS join_attempts (
  client_ip text NOT NULL,
  attempted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS join_attempts_ip ON join_attempts (client_ip, attempted_at);

CREATE TABLE IF NOT EXISTS orphaned_objects (
  object_key text PRIMARY KEY
);
`;

export const APP_TABLES = [
  "accounts", "verification_tokens", "sessions", "classrooms", "classroom_educators", "projects",
  "revisions", "idempotency_keys", "exports", "join_attempts", "orphaned_objects",
] as const;
