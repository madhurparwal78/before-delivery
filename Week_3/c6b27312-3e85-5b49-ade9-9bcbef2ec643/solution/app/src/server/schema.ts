// Applied idempotently on every start, under an advisory lock, so several app copies may boot together.
export const SCHEMA_LOCK = 7101;
export const OUTBOX_LOCK = 7102;
export const RELAY_LOCK = 7103;
export const SEED_LOCK = 7104;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (key text PRIMARY KEY, value text NOT NULL);

CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  email_fold text NOT NULL UNIQUE COLLATE "C",
  display_name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL,
  created_at timestamptz(3) NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verifications (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sources (ref text PRIMARY KEY, text text NOT NULL);

CREATE TABLE IF NOT EXISTS parts (
  slug text PRIMARY KEY COLLATE "C",
  title text NOT NULL COLLATE "C",
  category text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('public', 'private')),
  listed boolean NOT NULL DEFAULT true,
  owner_id text NOT NULL REFERENCES users(id),
  seed_position integer,
  created_at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS parts_owner ON parts (owner_id);

CREATE TABLE IF NOT EXISTS evaluations (
  id text PRIMARY KEY,
  part_slug text NOT NULL,
  viewer_id text NOT NULL,
  seq integer NOT NULL,
  status text NOT NULL,
  geometry_digest text,
  volume double precision NOT NULL DEFAULT 0,
  bbox jsonb NOT NULL DEFAULT '[0,0,0]',
  faces integer NOT NULL DEFAULT 0,
  solid jsonb,
  diagnostics jsonb NOT NULL DEFAULT '[]',
  started_at timestamptz(3) NOT NULL,
  finished_at timestamptz(3)
);
CREATE INDEX IF NOT EXISTS evaluations_viewer ON evaluations (viewer_id);

CREATE TABLE IF NOT EXISTS revisions (
  id text PRIMARY KEY,
  part_slug text NOT NULL REFERENCES parts(slug),
  n integer NOT NULL,
  parent_id text,
  author_id text NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL,
  param_values jsonb NOT NULL,
  source_ref text NOT NULL REFERENCES sources(ref),
  evaluation_id text NOT NULL REFERENCES evaluations(id),
  geometry_digest text NOT NULL,
  message text NOT NULL,
  restored_from text,
  forked_from_revision text,
  forked_from_operation integer,
  UNIQUE (part_slug, n)
);

CREATE TABLE IF NOT EXISTS tape_operations (
  revision_id text NOT NULL REFERENCES revisions(id),
  idx integer NOT NULL,
  kind text NOT NULL,
  op text NOT NULL,
  line integer,
  digest text NOT NULL,
  volume double precision NOT NULL,
  delta double precision NOT NULL,
  bbox jsonb NOT NULL,
  PRIMARY KEY (revision_id, idx)
);

CREATE TABLE IF NOT EXISTS preflight_reports (
  id text PRIMARY KEY,
  part_slug text NOT NULL,
  process text NOT NULL,
  param_values jsonb NOT NULL,
  geometry_digest text NOT NULL,
  status text NOT NULL,
  message text,
  findings jsonb NOT NULL,
  cost_bands jsonb NOT NULL,
  confidence text,
  created_at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS preflight_digest ON preflight_reports (geometry_digest, created_at DESC);

CREATE TABLE IF NOT EXISTS likes (
  part_slug text NOT NULL REFERENCES parts(slug),
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz(3) NOT NULL,
  PRIMARY KEY (part_slug, user_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  part_slug text NOT NULL REFERENCES parts(slug),
  base_revision_id text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id),
  title text NOT NULL,
  closed boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS rooms_part ON rooms (part_slug);

CREATE TABLE IF NOT EXISTS room_reviewers (
  room_id text NOT NULL REFERENCES rooms(id),
  email text NOT NULL,
  email_fold text NOT NULL COLLATE "C",
  PRIMARY KEY (room_id, email_fold)
);
CREATE INDEX IF NOT EXISTS room_reviewers_email ON room_reviewers (email_fold);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id),
  author_id text NOT NULL REFERENCES users(id),
  body text NOT NULL,
  anchor jsonb NOT NULL,
  pose jsonb NOT NULL,
  revision_id text NOT NULL,
  created_at timestamptz(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS comments_room ON comments (room_id, created_at, id);

CREATE TABLE IF NOT EXISTS approvals (
  room_id text NOT NULL REFERENCES rooms(id),
  reviewer_id text NOT NULL REFERENCES users(id),
  revision_id text NOT NULL,
  geometry_digest text NOT NULL,
  at timestamptz(3) NOT NULL,
  PRIMARY KEY (room_id, reviewer_id, geometry_digest)
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL CHECK (state IN ('in_progress', 'completed')),
  status integer,
  location text,
  etag text,
  body bytea,
  created_at timestamptz(3) NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, method, path, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  seq bigserial PRIMARY KEY,
  part_slug text NOT NULL,
  type text NOT NULL,
  room_id text,
  data jsonb NOT NULL,
  relayed boolean NOT NULL DEFAULT false,
  created_at timestamptz(3) NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_part ON outbox (part_slug, seq);
CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (seq) WHERE NOT relayed;
`;
