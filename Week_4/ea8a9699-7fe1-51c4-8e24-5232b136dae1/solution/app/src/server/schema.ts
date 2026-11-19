// The Postgres schema, applied idempotently at every start (brief: Services > Postgres).

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS app_settings (
  key text PRIMARY KEY,
  value text NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES groups(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  time_zone text NOT NULL,
  sort_order int NOT NULL,
  seeded_plan text NOT NULL,
  plan text NOT NULL,
  billing_account_id text,
  billing_subscription_id text,
  billing_synced boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  handle text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('ops_lead', 'designer', 'follower')),
  group_id uuid REFERENCES groups(id),
  workspace_id uuid REFERENCES workspaces(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seats (
  account_id uuid PRIMARY KEY REFERENCES accounts(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  assigned_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash text NOT NULL UNIQUE,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  email text NOT NULL,
  display_name text NOT NULL,
  invited_by uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS "references" (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL CHECK (kind IN ('image', 'clip', 'still')),
  title text NOT NULL,
  content_type text NOT NULL,
  ext text NOT NULL,
  created_at timestamptz NOT NULL,
  created_by uuid NOT NULL REFERENCES accounts(id),
  frame_rate int,
  duration_ms int,
  total_frames int,
  source_clip_id uuid,
  source_clip_title text,
  frame_index int,
  timecode text,
  seed_motif text
);
CREATE INDEX IF NOT EXISTS references_listing ON "references" (workspace_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS clusters (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  title text NOT NULL,
  public_description text NOT NULL DEFAULT '',
  internal_note text NOT NULL DEFAULT '',
  status text NOT NULL CHECK (status IN ('draft', 'in_review', 'embargoed', 'public', 'withdrawn')),
  owner_id uuid NOT NULL REFERENCES accounts(id),
  version int NOT NULL DEFAULT 1,
  lift_local text,
  lifts_at timestamptz,
  published_at timestamptz,
  created_at timestamptz NOT NULL,
  changed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS clusters_due ON clusters (lifts_at) WHERE status = 'embargoed';
CREATE INDEX IF NOT EXISTS clusters_feed ON clusters (published_at DESC, id DESC) WHERE status = 'public';
CREATE INDEX IF NOT EXISTS clusters_changed ON clusters (workspace_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  reference_id uuid NOT NULL REFERENCES "references"(id),
  position int NOT NULL,
  is_private boolean NOT NULL DEFAULT false,
  added_by uuid NOT NULL REFERENCES accounts(id),
  added_at timestamptz NOT NULL,
  UNIQUE (cluster_id, reference_id),
  CONSTRAINT entries_position UNIQUE (cluster_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS entries_reference ON entries (reference_id);

CREATE TABLE IF NOT EXISTS comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  author_name text NOT NULL,
  body text NOT NULL,
  account_id uuid REFERENCES accounts(id),
  review_email text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_cluster ON comments (cluster_id, created_at);
CREATE INDEX IF NOT EXISTS comments_review_window ON comments (cluster_id, review_email, created_at) WHERE review_email IS NOT NULL;

CREATE TABLE IF NOT EXISTS review_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  can_comment boolean NOT NULL,
  revoked_at timestamptz,
  inactive_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS retired_review_tokens (
  token_hash text PRIMARY KEY,
  link_id uuid NOT NULL REFERENCES review_links(id)
);

CREATE TABLE IF NOT EXISTS follows (
  follower_id uuid NOT NULL REFERENCES accounts(id),
  curator_id uuid NOT NULL REFERENCES accounts(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, curator_id)
);
CREATE INDEX IF NOT EXISTS follows_curator ON follows (curator_id);

CREATE TABLE IF NOT EXISTS digests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id uuid NOT NULL REFERENCES clusters(id),
  follower_id uuid NOT NULL REFERENCES accounts(id),
  lifts_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  UNIQUE (cluster_id, follower_id, lifts_at)
);
CREATE INDEX IF NOT EXISTS digests_pending ON digests (created_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS idempotency_records (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, key)
);
`;
