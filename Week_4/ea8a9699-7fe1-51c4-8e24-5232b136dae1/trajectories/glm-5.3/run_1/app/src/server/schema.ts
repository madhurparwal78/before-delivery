import type { Db } from './db.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  group_id uuid NOT NULL REFERENCES groups(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  time_zone text NOT NULL,
  position int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  handle text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  group_id uuid REFERENCES groups(id),
  workspace_id uuid REFERENCES workspaces(id),
  has_seat boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  display_name text NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS invites_email_idx ON invites (workspace_id, lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reference_items (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL,
  title text NOT NULL,
  ext text NOT NULL,
  content_type text NOT NULL,
  frame_rate int,
  duration_ms int,
  total_frames int,
  source_clip_id uuid,
  source_clip_title text,
  frame_index int,
  timecode text,
  created_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  stored_at timestamptz
);
CREATE INDEX IF NOT EXISTS references_ws_idx ON reference_items (workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS clusters (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  public_description text NOT NULL DEFAULT '',
  internal_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  owner_id uuid NOT NULL REFERENCES accounts(id),
  version int NOT NULL DEFAULT 1,
  lifts_at timestamptz,
  lifts_local text,
  published_at timestamptz,
  status_lock int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS clusters_ws_idx ON clusters (workspace_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS entries (
  id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  reference_id uuid NOT NULL REFERENCES reference_items(id),
  position int NOT NULL,
  is_private boolean NOT NULL DEFAULT false,
  added_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS entries_pos_idx ON entries (cluster_id, position);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_cluster_idx ON comments (cluster_id, created_at);

CREATE TABLE IF NOT EXISTS review_links (
  id uuid PRIMARY KEY,
  token text NOT NULL UNIQUE,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  expires_at timestamptz NOT NULL,
  can_comment boolean NOT NULL DEFAULT false,
  state text NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS review_links_cluster_idx ON review_links (cluster_id);

CREATE TABLE IF NOT EXISTS review_comment_counts (
  cluster_id uuid NOT NULL,
  email text NOT NULL,
  PRIMARY KEY (cluster_id, email)
);
CREATE TABLE IF NOT EXISTS review_comment_events (
  id bigserial PRIMARY KEY,
  cluster_id uuid NOT NULL,
  email text NOT NULL,
  accepted_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS review_comment_events_idx ON review_comment_events (cluster_id, email, accepted_at);

CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid NOT NULL REFERENCES accounts(id),
  curator_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, curator_id)
);

CREATE TABLE IF NOT EXISTS digests (
  id uuid PRIMARY KEY,
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  follower_id uuid NOT NULL REFERENCES accounts(id),
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cluster_id, follower_id)
);
CREATE INDEX IF NOT EXISTS digests_pending_idx ON digests (sent_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS seat_state (
  workspace_id uuid PRIMARY KEY REFERENCES workspaces(id),
  plan text NOT NULL,
  seat_cap int NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  key text NOT NULL,
  status text NOT NULL,
  request_body jsonb NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);
`;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}
