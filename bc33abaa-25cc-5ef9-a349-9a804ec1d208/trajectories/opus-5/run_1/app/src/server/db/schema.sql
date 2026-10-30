CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL,
  review_links_enabled boolean NOT NULL DEFAULT true,
  signing_secret text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  password_hash text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_active ON members (lower(email)) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS members_workspace ON members (workspace_id);

CREATE TABLE IF NOT EXISTS sessions (
  token_sha256 text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  workspace_id text NOT NULL REFERENCES workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  role text NOT NULL,
  token_sha256 text NOT NULL UNIQUE,
  invited_by_id text NOT NULL,
  invited_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS invitations_workspace ON invitations (workspace_id);

CREATE TABLE IF NOT EXISTS agent_tokens (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  scope text NOT NULL,
  secret_sha256 text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  issued_by_id text NOT NULL,
  issued_by_name text NOT NULL,
  warn_at timestamptz,
  warning_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE agent_tokens ADD COLUMN IF NOT EXISTS warn_at timestamptz;
CREATE INDEX IF NOT EXISTS agent_tokens_workspace ON agent_tokens (workspace_id);

CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  base_graph jsonb NOT NULL,
  latest_seq integer NOT NULL DEFAULT 0,
  embed_id text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS scenes_workspace ON scenes (workspace_id);

CREATE TABLE IF NOT EXISTS ops (
  scene_id text NOT NULL REFERENCES scenes(id),
  seq integer NOT NULL,
  batch_id text NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  inverse jsonb NOT NULL,
  author_kind text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  undo_of text,
  redo_of text,
  restore_to integer,
  PRIMARY KEY (scene_id, seq)
);
CREATE INDEX IF NOT EXISTS ops_author ON ops (scene_id, author_kind, author_id, seq);

CREATE TABLE IF NOT EXISTS object_locks (
  scene_id text NOT NULL REFERENCES scenes(id),
  node_id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  holder_kind text NOT NULL,
  holder_id text NOT NULL,
  holder_name text NOT NULL,
  expires_at timestamptz NOT NULL,
  pb_record_id text,
  PRIMARY KEY (scene_id, node_id)
);

CREATE TABLE IF NOT EXISTS presence (
  scene_id text NOT NULL REFERENCES scenes(id),
  author_kind text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  selection text,
  cursor jsonb,
  seen_at timestamptz NOT NULL DEFAULT now(),
  pb_record_id text,
  PRIMARY KEY (scene_id, author_kind, author_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  scene_id text NOT NULL REFERENCES scenes(id),
  node_id text NOT NULL,
  body text NOT NULL,
  author_kind text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  mentions jsonb NOT NULL DEFAULT '[]'::jsonb,
  resolved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  pb_record_id text
);
CREATE INDEX IF NOT EXISTS comments_scene ON comments (scene_id);

CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL,
  name text NOT NULL,
  bytes integer NOT NULL,
  content_type text NOT NULL,
  uploaded_by_kind text NOT NULL,
  uploaded_by_id text NOT NULL,
  uploaded_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS assets_workspace ON assets (workspace_id);

CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  scene_id text NOT NULL REFERENCES scenes(id),
  number integer NOT NULL,
  label text NOT NULL,
  state text NOT NULL,
  seq integer NOT NULL,
  graph jsonb NOT NULL,
  hash text NOT NULL,
  created_by_kind text NOT NULL,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  publish_at timestamptz,
  published_at timestamptz,
  embed_id text,
  thumbnail_stored boolean NOT NULL DEFAULT false,
  scheduled_by_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS versions_scene ON versions (scene_id);

CREATE TABLE IF NOT EXISTS approvals (
  version_id text NOT NULL REFERENCES versions(id),
  member_id text NOT NULL,
  member_name text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, member_id)
);

CREATE TABLE IF NOT EXISTS review_links (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  version_id text NOT NULL REFERENCES versions(id),
  token_sha256 text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by_kind text NOT NULL,
  created_by_id text NOT NULL,
  created_by_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  version_id text NOT NULL REFERENCES versions(id),
  bytes integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id),
  state text NOT NULL,
  plan text NOT NULL,
  period text NOT NULL,
  extra_seats integer NOT NULL DEFAULT 0,
  trial_ends_at timestamptz,
  grace_ends_at timestamptz,
  failed_at timestamptz,
  suspended_reason text,
  pending_change jsonb,
  card_last4 text,
  kb_account_id text,
  kb_bundle_id text,
  kb_base_subscription_id text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invoice_records (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  number text NOT NULL,
  amount_cents integer NOT NULL,
  balance_cents integer NOT NULL,
  invoice_date text NOT NULL,
  pdf_stored boolean NOT NULL DEFAULT false,
  seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS payment_records (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  invoice_id text NOT NULL,
  amount_cents integer NOT NULL,
  refunded_cents integer NOT NULL DEFAULT 0,
  charged_back boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  key text NOT NULL,
  route text NOT NULL,
  body_sha256 text NOT NULL,
  status integer,
  response jsonb,
  in_progress boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id text NOT NULL,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  body_sha256 text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS dunning_notices (
  workspace_id text NOT NULL REFERENCES workspaces(id),
  failed_at timestamptz NOT NULL,
  step integer NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, failed_at, step)
);

CREATE TABLE IF NOT EXISTS audit_entries (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  at timestamptz NOT NULL DEFAULT now(),
  actor_kind text NOT NULL,
  actor_id text NOT NULL,
  actor_name text NOT NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text NOT NULL,
  ordinal bigserial
);
CREATE INDEX IF NOT EXISTS audit_workspace ON audit_entries (workspace_id, at DESC, ordinal DESC);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id text PRIMARY KEY,
  dedupe_key text NOT NULL UNIQUE,
  workspace_id text,
  recipients jsonb NOT NULL,
  from_name text,
  subject text NOT NULL,
  body text NOT NULL,
  sent_at timestamptz,
  claimed_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE mail_outbox ADD COLUMN IF NOT EXISTS claimed_at timestamptz;
