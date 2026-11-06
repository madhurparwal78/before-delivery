export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  csrf_token text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  at timestamptz NOT NULL,
  cleared boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS signin_failures_ip ON signin_failures(ip, at);
CREATE TABLE IF NOT EXISTS signin_locks (
  id bigserial PRIMARY KEY,
  scope text NOT NULL,
  key text NOT NULL,
  started_at timestamptz NOT NULL,
  until timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS signin_locks_key ON signin_locks(scope, key, until);
CREATE TABLE IF NOT EXISTS diagrams (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);
CREATE TABLE IF NOT EXISTS pages (
  id uuid PRIMARY KEY,
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  seq bigserial,
  name text NOT NULL,
  version integer NOT NULL,
  doc jsonb NOT NULL,
  derived jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pages_diagram ON pages(diagram_id, seq);
CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY,
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  user_id uuid REFERENCES users(id),
  token_seed bytea,
  token_hash text UNIQUE,
  expires_at timestamptz,
  invited_at timestamptz,
  delivered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS shares_open_email ON shares(diagram_id, email) WHERE status IN ('invited', 'active');
CREATE TABLE IF NOT EXISTS messages (
  id uuid PRIMARY KEY,
  kind text NOT NULL,
  share_id uuid NOT NULL REFERENCES shares(id),
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  recipient text NOT NULL,
  status text NOT NULL,
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS messages_queued ON messages(status, created_at);
CREATE TABLE IF NOT EXISTS invite_lookup_failures (
  id bigserial PRIMARY KEY,
  ip text NOT NULL,
  at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS invite_lookup_failures_ip ON invite_lookup_failures(ip, at);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  created_by text NOT NULL,
  status text NOT NULL,
  page_ids jsonb NOT NULL,
  files jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS exports_diagram ON exports(diagram_id, created_at);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id uuid NOT NULL,
  diagram_id uuid NOT NULL,
  key text NOT NULL,
  state text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, diagram_id, key)
);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY,
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  page_id uuid NOT NULL REFERENCES pages(id),
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS imports_diagram ON imports(diagram_id, created_at);
CREATE TABLE IF NOT EXISTS download_links (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  diagram_id uuid NOT NULL REFERENCES diagrams(id),
  object_key text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  sha256 text,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS audit_events (
  id bigserial PRIMARY KEY,
  diagram_id uuid REFERENCES diagrams(id),
  account_id uuid REFERENCES users(id),
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor text NOT NULL,
  action text NOT NULL,
  detail jsonb NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_diagram ON audit_events(diagram_id, id);
CREATE INDEX IF NOT EXISTS audit_account ON audit_events(account_id, id);
`;
