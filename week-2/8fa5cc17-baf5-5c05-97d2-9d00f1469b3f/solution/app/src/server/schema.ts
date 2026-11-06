// The PostgreSQL schema, applied idempotently every time the app serves.

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS owner_account (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS workspace_settings (
  id int PRIMARY KEY CHECK (id = 1),
  home_time_zone text NOT NULL,
  theme text NOT NULL CHECK (theme IN ('paper', 'lamplight'))
);
CREATE TABLE IF NOT EXISTS device_sessions (
  id uuid PRIMARY KEY,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  ended_at timestamptz
);
CREATE TABLE IF NOT EXISTS sign_in_failures (
  identity_kind text NOT NULL,
  identity text NOT NULL,
  failed_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sign_in_failures_identity ON sign_in_failures (identity_kind, identity, failed_at);
CREATE TABLE IF NOT EXISTS sign_in_locks (
  identity_kind text NOT NULL,
  identity text NOT NULL,
  locked_until timestamptz NOT NULL,
  PRIMARY KEY (identity_kind, identity)
);
CREATE TABLE IF NOT EXISTS object_types (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  builtin_rank int,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS object_types_name ON object_types (lower(name));
CREATE TABLE IF NOT EXISTS fields (
  id uuid PRIMARY KEY,
  type_id uuid NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
  position int NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  required boolean NOT NULL,
  options jsonb,
  target_type_id uuid REFERENCES object_types(id)
);
CREATE UNIQUE INDEX IF NOT EXISTS fields_name ON fields (type_id, lower(name));
CREATE TABLE IF NOT EXISTS objects (
  id uuid PRIMARY KEY,
  type_id uuid NOT NULL REFERENCES object_types(id),
  title text NOT NULL,
  daily_date date UNIQUE,
  properties jsonb NOT NULL DEFAULT '{}',
  share_visibility text NOT NULL DEFAULT 'follow',
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS attachments (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  filename text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  storage_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS blocks (
  id uuid PRIMARY KEY,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('text', 'quote', 'attachment')),
  position int NOT NULL,
  body text,
  plain text,
  version int,
  origin_block_id uuid REFERENCES blocks(id),
  attachment_id uuid REFERENCES attachments(id) ON DELETE CASCADE,
  edited_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS blocks_object ON blocks (object_id, position);
CREATE INDEX IF NOT EXISTS blocks_origin ON blocks (origin_block_id);
CREATE TABLE IF NOT EXISTS revisions (
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  version int NOT NULL,
  body text NOT NULL,
  ops jsonb,
  edit_kind text NOT NULL CHECK (edit_kind IN ('create', 'ops', 'replace', 'restore')),
  label text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (block_id, version)
);
CREATE TABLE IF NOT EXISTS link_edges (
  id uuid PRIMARY KEY,
  from_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('quote', 'relation')),
  quote_block_id uuid REFERENCES blocks(id) ON DELETE CASCADE,
  field_name text,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS link_edges_to ON link_edges (to_object_id);
CREATE INDEX IF NOT EXISTS link_edges_from ON link_edges (from_object_id);
CREATE TABLE IF NOT EXISTS presence (
  session_id uuid NOT NULL,
  block_id uuid NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  anchor int NOT NULL,
  head int NOT NULL,
  version int NOT NULL,
  reported_at timestamptz NOT NULL,
  PRIMARY KEY (session_id, block_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_name ON collections (lower(name));
CREATE TABLE IF NOT EXISTS collection_members (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, object_id)
);
CREATE TABLE IF NOT EXISTS board_positions (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id uuid NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  x int NOT NULL,
  y int NOT NULL,
  PRIMARY KEY (collection_id, object_id)
);
CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  collection_id uuid NOT NULL,
  token text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  type_id uuid NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
  text text NOT NULL,
  group_by text,
  sort jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  endpoint text NOT NULL,
  key text NOT NULL,
  request jsonb NOT NULL,
  status int NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (key)
);
CREATE TABLE IF NOT EXISTS sync_sequence (
  id int PRIMARY KEY CHECK (id = 1),
  last_id bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS sync_events (
  id bigint PRIMARY KEY,
  event text NOT NULL,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS share_cache (
  share_link_id uuid NOT NULL,
  object_id uuid NOT NULL,
  origin_object_ids uuid[] NOT NULL,
  PRIMARY KEY (share_link_id, object_id)
);
INSERT INTO sync_sequence (id, last_id) VALUES (1, 0) ON CONFLICT DO NOTHING;
`;
