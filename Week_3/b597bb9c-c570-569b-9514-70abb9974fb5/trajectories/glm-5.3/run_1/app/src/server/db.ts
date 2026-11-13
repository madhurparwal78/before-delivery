import pg from 'pg';

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspace (
  id SERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL UNIQUE,
  owner_person_id TEXT NOT NULL,
  availability TEXT NOT NULL DEFAULT '',
  carried_storage_bytes BIGINT NOT NULL DEFAULT 0,
  opening_minutes INT NOT NULL DEFAULT 0,
  opening_month TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  handle TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  title TEXT NOT NULL,
  agency TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  frame_rate TEXT NOT NULL,
  aspect_ratio TEXT NOT NULL,
  time_unit TEXT NOT NULL DEFAULT 'frames',
  version INT NOT NULL DEFAULT 0,
  seed_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people(id),
  role TEXT NOT NULL,
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS rows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  position INT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS clips (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  media_id TEXT,
  start_frame NUMERIC NOT NULL,
  end_frame NUMERIC NOT NULL,
  source_in NUMERIC NOT NULL,
  source_out NUMERIC NOT NULL,
  speed_percent INT NOT NULL DEFAULT 100,
  hidden BOOLEAN NOT NULL DEFAULT false,
  group_id TEXT,
  text TEXT,
  text_colour TEXT,
  box_colour TEXT,
  font_weight INT,
  keyframes JSONB NOT NULL DEFAULT '{}',
  add_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS captions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_id TEXT NOT NULL REFERENCES rows(id) ON DELETE CASCADE,
  start_frame NUMERIC NOT NULL,
  end_frame NUMERIC NOT NULL,
  text TEXT NOT NULL,
  original_start_ms INT,
  original_end_ms INT,
  srt_bom BOOLEAN NOT NULL DEFAULT false,
  srt_crlf BOOLEAN NOT NULL DEFAULT false,
  imported BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS markers (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  frame NUMERIC NOT NULL,
  label TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (project_id, frame)
);

CREATE TABLE IF NOT EXISTS ops (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  version INT NOT NULL,
  person_id TEXT NOT NULL,
  person_name TEXT NOT NULL,
  op_type TEXT NOT NULL,
  op JSONB NOT NULL,
  undo_data JSONB NOT NULL DEFAULT '{}',
  PRIMARY KEY (project_id, version)
);

CREATE TABLE IF NOT EXISTS undo_stack (
  person_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INT NOT NULL,
  PRIMARY KEY (person_id, project_id, version)
);

CREATE TABLE IF NOT EXISTS redo_stack (
  person_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  version INT NOT NULL,
  PRIMARY KEY (person_id, project_id, version)
);

CREATE TABLE IF NOT EXISTS cuts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INT NOT NULL,
  total_frames INT NOT NULL,
  shared BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  snapshot JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS cut_approvals (
  cut_id TEXT NOT NULL REFERENCES cuts(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cut_id, name)
);

CREATE TABLE IF NOT EXISTS comments (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL,
  parent_id TEXT,
  cut_id TEXT,
  frame NUMERIC NOT NULL,
  live_offset INT NOT NULL DEFAULT 0,
  row_id TEXT,
  clip_id TEXT,
  live_frame INT NOT NULL,
  mentions TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS comment_drafts (
  person_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  body TEXT NOT NULL,
  frame INT NOT NULL,
  row_id TEXT,
  clip_id TEXT,
  cut_id TEXT,
  visibility TEXT NOT NULL DEFAULT 'team',
  parent_id TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, project_id)
);

CREATE TABLE IF NOT EXISTS review_links (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token TEXT NOT NULL UNIQUE,
  cut_id TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  state TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS read_tokens (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_used_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS kits (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  text_colour TEXT NOT NULL,
  box_colour TEXT NOT NULL,
  font_weight INT NOT NULL
);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  folder TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL UNIQUE,
  width INT,
  height INT,
  duration_timescale INT,
  duration INT,
  sample_rate INT,
  sample_frames INT,
  channels INT,
  bits INT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  folder TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  replaces TEXT,
  chunks INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS upload_chunks (
  upload_id TEXT NOT NULL,
  chunk_no INT NOT NULL,
  bytes INT NOT NULL,
  PRIMARY KEY (upload_id, chunk_no)
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cut_id TEXT NOT NULL,
  cut_name TEXT NOT NULL,
  size INT NOT NULL,
  state TEXT NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  minutes INT NOT NULL,
  stale BOOLEAN NOT NULL DEFAULT false,
  requested_by TEXT NOT NULL,
  manifest_checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS outbox (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'waiting',
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  project_title TEXT NOT NULL,
  person_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  frame INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  window_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mention_windows (
  person_id TEXT NOT NULL,
  project_id TEXT NOT NULL,
  window_key TEXT NOT NULL,
  closes_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (person_id, project_id, window_key)
);

CREATE INDEX IF NOT EXISTS clips_project_row ON clips(project_id, row_id);
CREATE INDEX IF NOT EXISTS clips_sha ON clips(media_id);
CREATE INDEX IF NOT EXISTS ops_version ON ops(project_id, version);
CREATE INDEX IF NOT EXISTS comments_cut ON comments(project_id, cut_id);
CREATE INDEX IF NOT EXISTS exports_project ON exports(project_id, created_at);
`;

export type Db = pg.Pool;

export async function connectDatabase(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  await pool.query('SELECT 1');
  return pool;
}

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
  await db.query(REPLAY_TABLE_SQL);
}

export const REPLAY_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS op_replays (
  project_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  op_id TEXT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, person_id, op_id)
);
`;
