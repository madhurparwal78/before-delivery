// The database schema, applied idempotently on every serve.

export const SCHEMA_SQL = `-- Quire schema. Applied idempotently on every serve.

CREATE TABLE IF NOT EXISTS owner_account (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL,
  email_norm TEXT NOT NULL,
  display_name TEXT NOT NULL,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  id INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  home_time_zone TEXT NOT NULL,
  theme TEXT NOT NULL CHECK (theme IN ('paper', 'lamplight'))
);

CREATE TABLE IF NOT EXISTS object_types (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  builtin BOOLEAN NOT NULL DEFAULT FALSE,
  library_order INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS object_types_name_ci ON object_types (LOWER(name));

CREATE TABLE IF NOT EXISTS type_fields (
  id UUID PRIMARY KEY,
  type_id UUID NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('text','number','date','url','select','relation')),
  required BOOLEAN NOT NULL DEFAULT FALSE,
  options JSONB,
  target_type_id UUID REFERENCES object_types(id) ON DELETE RESTRICT,
  position INT NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS type_fields_ci ON type_fields (type_id, LOWER(name));

CREATE TABLE IF NOT EXISTS objects (
  id UUID PRIMARY KEY,
  type_id UUID NOT NULL REFERENCES object_types(id) ON DELETE RESTRICT,
  title TEXT NOT NULL,
  daily_date TEXT, -- 'YYYY-MM-DD' for daily notes, else null
  share_visibility TEXT NOT NULL DEFAULT 'follow' CHECK (share_visibility IN ('follow','never')),
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS objects_daily_date ON objects (daily_date) WHERE daily_date IS NOT NULL;
CREATE INDEX IF NOT EXISTS objects_type ON objects (type_id);

CREATE TABLE IF NOT EXISTS properties (
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  field_name TEXT NOT NULL,
  value JSONB, -- typed value or null
  PRIMARY KEY (object_id, field_name)
);

CREATE TABLE IF NOT EXISTS blocks (
  id UUID PRIMARY KEY,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('text','quote','attachment')),
  position INT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  version INT NOT NULL DEFAULT 1,
  origin_block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
  attachment_id UUID,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS blocks_object ON blocks (object_id, position);
CREATE INDEX IF NOT EXISTS blocks_origin ON blocks (origin_block_id);

CREATE TABLE IF NOT EXISTS revisions (
  block_id UUID NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  version INT NOT NULL,
  body TEXT NOT NULL,
  plain TEXT NOT NULL,
  label TEXT NOT NULL,
  ops JSONB, -- ops of this revision as committed (null for full replacement/restore)
  is_full BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (block_id, version)
);

CREATE TABLE IF NOT EXISTS attachments (
  id UUID PRIMARY KEY,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS link_edges (
  id BIGSERIAL PRIMARY KEY,
  from_object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  to_object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('quote','relation')),
  block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
  field_name TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS link_edges_to ON link_edges (to_object_id);
CREATE INDEX IF NOT EXISTS link_edges_from ON link_edges (from_object_id);

CREATE TABLE IF NOT EXISTS collections (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS collections_name_ci ON collections (LOWER(name));

CREATE TABLE IF NOT EXISTS collection_members (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  PRIMARY KEY (collection_id, object_id)
);

CREATE TABLE IF NOT EXISTS board_positions (
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  object_id UUID NOT NULL REFERENCES objects(id) ON DELETE CASCADE,
  x INT NOT NULL,
  y INT NOT NULL,
  PRIMARY KEY (collection_id, object_id)
);

CREATE TABLE IF NOT EXISTS saved_queries (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  type_id UUID NOT NULL REFERENCES object_types(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  group_by TEXT,
  sort JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id UUID PRIMARY KEY,
  collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY, -- the cookie value
  public_id TEXT NOT NULL UNIQUE, -- the sessions-endpoint handle
  csrf_token TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
  identity TEXT PRIMARY KEY, -- 'email:<norm>' or 'addr:<ip>'
  failure_times TIMESTAMPTZ[] NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  owner_key TEXT NOT NULL, -- '<endpoint-scoped key>'
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status INT NOT NULL,
  response_body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (owner_key, key, endpoint)
);

CREATE TABLE IF NOT EXISTS presence (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  block_id UUID NOT NULL REFERENCES blocks(id) ON DELETE CASCADE,
  anchor INT,
  head INT,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (session_id, block_id)
);

CREATE TABLE IF NOT EXISTS sync_events (
  id BIGSERIAL PRIMARY KEY,
  event_type TEXT NOT NULL,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sync_events_created ON sync_events (created_at);
`;
