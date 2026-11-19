/**
 * The PostgreSQL schema, applied idempotently every time the app serves.
 */

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  layout TEXT NOT NULL DEFAULT 'map',
  theme TEXT NOT NULL DEFAULT 'daylight',
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL DEFAULT 0,
  seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  custom_colours TEXT NOT NULL DEFAULT '[]',
  version_baseline TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS topics (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  parent_id TEXT,
  rank INTEGER NOT NULL DEFAULT 0,
  floating BOOLEAN NOT NULL DEFAULT FALSE,
  x DOUBLE PRECISION,
  y DOUBLE PRECISION,
  title TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  icon TEXT,
  colour TEXT,
  shape TEXT,
  side_pin TEXT,
  task JSONB,
  locked_by TEXT,
  restricted BOOLEAN NOT NULL DEFAULT FALSE,
  attachments JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (map_id, id)
);
CREATE INDEX IF NOT EXISTS topics_parent_idx ON topics (map_id, parent_id);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='topics' AND column_name='attachments') THEN
    ALTER TABLE topics ADD COLUMN attachments JSONB NOT NULL DEFAULT '[]';
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  type TEXT NOT NULL,
  state TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cross_links (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  "from" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  type TEXT NOT NULL,
  PRIMARY KEY (map_id, id)
);

CREATE TABLE IF NOT EXISTS boundaries (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (map_id, id)
);

CREATE TABLE IF NOT EXISTS members (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (map_id, username)
);

CREATE TABLE IF NOT EXISTS guests (
  token TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  role TEXT NOT NULL,
  link_id TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  state TEXT NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS op_log (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  seq BIGSERIAL PRIMARY KEY,
  group_id TEXT NOT NULL,
  author TEXT NOT NULL,
  base_revision BIGINT NOT NULL,
  ops JSONB NOT NULL,
  revision BIGINT NOT NULL,
  results JSONB NOT NULL,
  notice TEXT,
  sentence TEXT,
  kind TEXT,
  topic_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS op_log_map_idx ON op_log (map_id, seq);

CREATE TABLE IF NOT EXISTS op_ids (
  map_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  group_id TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (map_id, op_id)
);

CREATE TABLE IF NOT EXISTS undo_stack (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  entries JSONB NOT NULL DEFAULT '[]',
  redo JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (map_id, username)
);

CREATE TABLE IF NOT EXISTS collapsed (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  PRIMARY KEY (map_id, username, topic_id)
);

CREATE TABLE IF NOT EXISTS recovered (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  username TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL,
  from_title TEXT NOT NULL,
  parent_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_to TEXT,
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comments_topic_idx ON comments (map_id, topic_id);

CREATE TABLE IF NOT EXISTS votes (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  topic_id TEXT NOT NULL,
  username TEXT NOT NULL,
  PRIMARY KEY (map_id, topic_id, username)
);

CREATE TABLE IF NOT EXISTS mentions (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL,
  topic_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  "by" TEXT NOT NULL,
  username TEXT NOT NULL,
  read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS mentions_user_idx ON mentions (username, read);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  "by" TEXT NOT NULL,
  revision BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS versions_number_idx ON versions (map_id, number);

CREATE TABLE IF NOT EXISTS presentations (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  code TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting',
  slide_index INTEGER NOT NULL DEFAULT 0,
  presenter TEXT NOT NULL,
  followers INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_presenter_seen TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS slides (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  topic_id TEXT NOT NULL,
  PRIMARY KEY (map_id, position)
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER NOT NULL DEFAULT 0,
  format TEXT NOT NULL,
  topic_id TEXT,
  next_step_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id TEXT PRIMARY KEY,
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  sha256 TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  topic_count INTEGER NOT NULL,
  preview JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clipboards (
  username TEXT PRIMARY KEY,
  topics JSONB NOT NULL DEFAULT '[]',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  map_id TEXT NOT NULL REFERENCES maps(id) ON DELETE CASCADE,
  seq BIGSERIAL PRIMARY KEY,
  "user" TEXT NOT NULL,
  sentence TEXT NOT NULL,
  topic_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_map_idx ON activity (map_id, seq DESC);

CREATE TABLE IF NOT EXISTS presence (
  map_id TEXT NOT NULL,
  username TEXT NOT NULL,
  colour INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL,
  guest BOOLEAN NOT NULL DEFAULT FALSE,
  zoom DOUBLE PRECISION NOT NULL DEFAULT 1,
  pan_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  pan_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  width DOUBLE PRECISION NOT NULL DEFAULT 800,
  height DOUBLE PRECISION NOT NULL DEFAULT 600,
  cursor_x DOUBLE PRECISION NOT NULL DEFAULT 0,
  cursor_y DOUBLE PRECISION NOT NULL DEFAULT 0,
  cursor_topic TEXT,
  last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_socket_closed TIMESTAMPTZ,
  PRIMARY KEY (map_id, username)
);

CREATE TABLE IF NOT EXISTS op_rate (
  username TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, window_start)
);

CREATE TABLE IF NOT EXISTS login_rate (
  username TEXT NOT NULL,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (username, window_start)
);

CREATE TABLE IF NOT EXISTS kv (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);
`;
