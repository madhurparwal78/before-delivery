import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30_000,
});

export async function query(text: string, params: unknown[] = []): Promise<import("pg").QueryResult> {
  return pool.query(text, params as never[]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  review_links_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  gateway_secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seeded_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  removed_at TIMESTAMPTZ,
  UNIQUE (workspace_id, email)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT NOT NULL REFERENCES members(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  invited_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  accepted_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS agent_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  scope TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  issued_by TEXT NOT NULL,
  issued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active',
  warned_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS scenes (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  embed_id TEXT
);
CREATE TABLE IF NOT EXISTS ops (
  seq BIGINT NOT NULL,
  batch_id TEXT NOT NULL,
  scene_id TEXT NOT NULL REFERENCES scenes(id),
  type TEXT NOT NULL,
  payload JSONB NOT NULL,
  inverse JSONB NOT NULL,
  author_kind TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  undo_of TEXT,
  redo_of TEXT,
  restore_to BIGINT,
  PRIMARY KEY (scene_id, seq)
);
CREATE TABLE IF NOT EXISTS scene_bases (
  scene_id TEXT PRIMARY KEY REFERENCES scenes(id),
  graph JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS author_batches (
  scene_id TEXT NOT NULL,
  author_key TEXT NOT NULL,
  batch_id TEXT NOT NULL,
  first_seq BIGINT NOT NULL,
  undone BOOLEAN NOT NULL DEFAULT FALSE,
  undone_by_seq BIGINT,
  redo_cleared BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (scene_id, author_key, batch_id)
);
CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes(id),
  number INT NOT NULL,
  label TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  seq BIGINT NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_by_kind TEXT NOT NULL DEFAULT 'member',
  publish_at TIMESTAMPTZ,
  published_at TIMESTAMPTZ,
  scheduled_by TEXT,
  snapshot_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (scene_id, number)
);
CREATE TABLE IF NOT EXISTS approvals (
  version_id TEXT NOT NULL REFERENCES versions(id),
  member_id TEXT NOT NULL,
  member_name TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (version_id, member_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  scene_id TEXT NOT NULL REFERENCES scenes(id),
  node_id TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_kind TEXT NOT NULL DEFAULT 'member',
  author_name TEXT NOT NULL,
  mentions JSONB NOT NULL DEFAULT '[]',
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assets (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  bytes INT NOT NULL,
  content_type TEXT NOT NULL,
  uploaded_by_id TEXT NOT NULL,
  uploaded_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS review_links (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_by_id TEXT NOT NULL,
  created_by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ,
  regenerated_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  version_id TEXT NOT NULL REFERENCES versions(id),
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS audit (
  id BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  actor_kind TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_name TEXT NOT NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
  state TEXT NOT NULL DEFAULT 'trial',
  plan TEXT NOT NULL DEFAULT 'team',
  period TEXT NOT NULL DEFAULT 'monthly',
  seats_purchased INT NOT NULL DEFAULT 8,
  extra_seats INT NOT NULL DEFAULT 0,
  trial_ends_at TIMESTAMPTZ,
  grace_ends_at TIMESTAMPTZ,
  dunning_failed_at TIMESTAMPTZ,
  dunning_notices JSONB NOT NULL DEFAULT '[]',
  kb_account_id TEXT,
  kb_base_sub_id TEXT,
  kb_seat_sub_ids JSONB NOT NULL DEFAULT '[]',
  kb_charged_through TIMESTAMPTZ,
  pending_change JSONB,
  card_last4 TEXT,
  cancel_scheduled BOOLEAN NOT NULL DEFAULT FALSE,
  cancelled_at TIMESTAMPTZ
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  number TEXT NOT NULL,
  date TIMESTAMPTZ NOT NULL,
  amount_cents INT NOT NULL,
  balance_cents INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unpaid',
  pdf_stored BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT NOT NULL,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id),
  invoice_id TEXT NOT NULL,
  amount_cents INT NOT NULL,
  refunded_cents INT NOT NULL DEFAULT 0,
  charged_back BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, id)
);
CREATE TABLE IF NOT EXISTS idempotency (
  workspace_id TEXT NOT NULL,
  key TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INT NOT NULL,
  body JSONB NOT NULL,
  in_progress BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE webhook_events ADD COLUMN IF NOT EXISTS body_hash TEXT;
CREATE INDEX IF NOT EXISTS ops_scene_seq ON ops (scene_id, seq);
CREATE INDEX IF NOT EXISTS author_batches_lookup ON author_batches (scene_id, author_key, first_seq DESC);
CREATE INDEX IF NOT EXISTS audit_ws_at ON audit (workspace_id, at DESC);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}
