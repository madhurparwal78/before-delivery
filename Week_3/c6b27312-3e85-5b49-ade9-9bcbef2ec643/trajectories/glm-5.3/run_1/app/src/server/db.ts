import pg from "pg";

export type Db = pg.Pool;

export async function connect(url: string): Promise<pg.Pool> {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  });
  // Verify connectivity eagerly with retry, applied by the caller.
  await pool.query("select 1");
  return pool;
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verify_tokens (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id),
  next text NOT NULL DEFAULT '/',
  used boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS parts (
  slug text PRIMARY KEY,
  title text NOT NULL,
  category text NOT NULL,
  visibility text NOT NULL DEFAULT 'public',
  owner_id text NOT NULL REFERENCES users(id),
  seed_position integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sources (
  key text PRIMARY KEY,
  bytes bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS revisions (
  id text PRIMARY KEY,
  part_slug text NOT NULL REFERENCES parts(slug),
  label integer NOT NULL,
  parent_id text,
  author_id text NOT NULL REFERENCES users(id),
  values jsonb NOT NULL,
  source_key text NOT NULL,
  evaluation_id text,
  geometry_digest text NOT NULL,
  message text NOT NULL DEFAULT '',
  restored_from text,
  forked_from jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (part_slug, label)
);
CREATE TABLE IF NOT EXISTS evaluations (
  id text PRIMARY KEY,
  part_slug text NOT NULL,
  viewer_id text NOT NULL,
  seq integer NOT NULL,
  status text NOT NULL,
  geometry_digest text,
  volume numeric,
  bbox jsonb,
  faces integer,
  solid jsonb,
  diagnostics jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
CREATE TABLE IF NOT EXISTS reports (
  id text PRIMARY KEY,
  part_slug text NOT NULL,
  process text NOT NULL,
  values jsonb NOT NULL,
  geometry_digest text,
  status text NOT NULL,
  message text,
  findings jsonb NOT NULL,
  cost_bands jsonb NOT NULL,
  confidence text,
  visitor_session text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tapes (
  revision_id text PRIMARY KEY REFERENCES revisions(id),
  n integer NOT NULL,
  operations jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  part_slug text NOT NULL REFERENCES parts(slug),
  title text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  required_approvals integer NOT NULL,
  created_by text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS room_reviewers (
  room_id text NOT NULL REFERENCES rooms(id),
  email text NOT NULL,
  user_id text,
  PRIMARY KEY (room_id, email)
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  room_id text NOT NULL REFERENCES rooms(id),
  author_id text NOT NULL REFERENCES users(id),
  body text NOT NULL,
  anchor jsonb NOT NULL,
  pose jsonb NOT NULL,
  revision_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS approvals (
  room_id text NOT NULL REFERENCES rooms(id),
  reviewer_id text NOT NULL REFERENCES users(id),
  revision_id text NOT NULL REFERENCES revisions(id),
  geometry_digest text NOT NULL,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (room_id, reviewer_id, geometry_digest)
);
CREATE TABLE IF NOT EXISTS likes (
  part_slug text NOT NULL REFERENCES parts(slug),
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (part_slug, user_id)
);
CREATE TABLE IF NOT EXISTS idempotency (
  caller_id text NOT NULL,
  method_path text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  state text NOT NULL,
  response_status integer,
  response_location text,
  response_etag text,
  response_body bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (caller_id, method_path, key)
);
CREATE TABLE IF NOT EXISTS outbox (
  seq bigserial PRIMARY KEY,
  type text NOT NULL,
  part_slug text NOT NULL,
  room_id text,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_outbox_created ON outbox (created_at);
CREATE INDEX IF NOT EXISTS idx_evaluations_viewer ON evaluations (viewer_id);
CREATE INDEX IF NOT EXISTS idx_revisions_part ON revisions (part_slug, label);
`;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}
