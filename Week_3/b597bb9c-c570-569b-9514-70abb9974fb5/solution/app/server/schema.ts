/** Applied idempotently on every serve. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, handle text NOT NULL UNIQUE,
  password_hash text NOT NULL, is_owner boolean NOT NULL DEFAULT false, seq bigserial
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY, person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspace (
  id text PRIMARY KEY, owner_id text NOT NULL REFERENCES people(id), availability text NOT NULL,
  carried_storage_bytes bigint NOT NULL, opening_minutes int NOT NULL, opening_month text NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, title text NOT NULL, agency text NOT NULL, description text NOT NULL,
  frame_rate text NOT NULL, aspect_ratio text NOT NULL, time_unit text NOT NULL DEFAULT 'frames',
  version int NOT NULL DEFAULT 1, position bigserial, created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL, seq bigserial, PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS rows (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL, position int NOT NULL, locked boolean NOT NULL DEFAULT false,
  srt_eol text NOT NULL DEFAULT E'\\n', srt_bom boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS media (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL, folder text NOT NULL, bytes bigint NOT NULL,
  sha256 text NOT NULL UNIQUE, width int, height int, duration_seconds numeric, sample_rate int,
  src_num bigint NOT NULL, src_den bigint NOT NULL, words text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE TABLE IF NOT EXISTS clips (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_id text NOT NULL, name text NOT NULL, kind text NOT NULL, media_id text REFERENCES media(id),
  start_frame int NOT NULL DEFAULT 0, end_frame int NOT NULL DEFAULT 0,
  source_in int NOT NULL DEFAULT 0, source_out int NOT NULL DEFAULT 0, speed_percent int NOT NULL DEFAULT 100,
  hidden boolean NOT NULL DEFAULT false, group_id text, text text, text_colour text, box_colour text,
  font_weight int, keyframes jsonb NOT NULL DEFAULT '{}', base jsonb NOT NULL DEFAULT '{}',
  legacy jsonb, seq bigserial
);
CREATE INDEX IF NOT EXISTS clips_project ON clips (project_id, seq);
CREATE TABLE IF NOT EXISTS captions (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row_id text NOT NULL, start_frame int NOT NULL DEFAULT 0, end_frame int NOT NULL DEFAULT 0, text text NOT NULL,
  orig_start_ms int, orig_end_ms int, legacy jsonb, seq bigserial
);
CREATE INDEX IF NOT EXISTS captions_row ON captions (project_id, row_id, start_frame);
CREATE TABLE IF NOT EXISTS markers (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  frame int NOT NULL DEFAULT 0, label text NOT NULL DEFAULT '', legacy numeric
);
CREATE TABLE IF NOT EXISTS ops (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, version int NOT NULL,
  op_id text NOT NULL, person_id text NOT NULL, type text NOT NULL, summary jsonb NOT NULL,
  changes jsonb NOT NULL, removed jsonb NOT NULL, stopped jsonb, touched text[] NOT NULL,
  forward jsonb, inverse jsonb, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, version), UNIQUE (project_id, person_id, op_id)
);
CREATE TABLE IF NOT EXISTS undo_entries (
  id bigserial PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id text NOT NULL, op_version int NOT NULL, stack text NOT NULL
);
CREATE INDEX IF NOT EXISTS undo_person ON undo_entries (project_id, person_id, stack, id);
CREATE TABLE IF NOT EXISTS cuts (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL, version int NOT NULL, total_frames int NOT NULL, shared boolean NOT NULL DEFAULT false,
  snapshot jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial,
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS approvals (
  id bigserial PRIMARY KEY, cut_id text NOT NULL REFERENCES cuts(id) ON DELETE CASCADE,
  name text NOT NULL, at timestamptz NOT NULL DEFAULT now(), UNIQUE (cut_id, name)
);
CREATE TABLE IF NOT EXISTS review_links (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cut_id text NOT NULL REFERENCES cuts(id), token text NOT NULL UNIQUE, expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  author_id text, author_name text NOT NULL, body text NOT NULL, visibility text NOT NULL,
  parent_id text, cut_id text, pin_frame int NOT NULL DEFAULT 0, pin_row_id text, pin_clip_id text,
  pin_offset int, mentions jsonb NOT NULL DEFAULT '[]', legacy numeric,
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE INDEX IF NOT EXISTS comments_project ON comments (project_id, seq);
CREATE TABLE IF NOT EXISTS comment_drafts (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, person_id text NOT NULL,
  body text NOT NULL, frame int NOT NULL DEFAULT 0, row_id text, clip_id text, cut_id text,
  visibility text NOT NULL DEFAULT 'team', parent_id text, updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS notifications (
  id bigserial PRIMARY KEY, person_id text NOT NULL, project_id text NOT NULL,
  author_name text NOT NULL, frame int NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), outbox_id text
);
CREATE TABLE IF NOT EXISTS kits (
  id text PRIMARY KEY, name text NOT NULL, text_colour text NOT NULL, box_colour text NOT NULL,
  font_weight int NOT NULL, seq bigserial
);
CREATE TABLE IF NOT EXISTS tokens (
  id text PRIMARY KEY, name text NOT NULL, token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(), last_used_at timestamptz
);
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY, person_id text NOT NULL, file_name text NOT NULL, folder text NOT NULL,
  bytes bigint NOT NULL, sha256 text NOT NULL, replaces text, chunks int NOT NULL,
  received int[] NOT NULL DEFAULT '{}', state text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(), seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS uploads_open ON uploads (person_id, sha256) WHERE state IN ('open','receiving');
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  cut_id text NOT NULL REFERENCES cuts(id), size int NOT NULL, state text NOT NULL DEFAULT 'queued',
  progress int NOT NULL DEFAULT 0, minutes int NOT NULL, requested_by text NOT NULL,
  manifest_checksum text, created_at timestamptz NOT NULL DEFAULT now(), finished_at timestamptz,
  finished_version int, seq bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS exports_live ON exports (cut_id, size) WHERE state IN ('queued','running','done');
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY, to_email text NOT NULL, subject text NOT NULL, body text NOT NULL,
  state text NOT NULL DEFAULT 'waiting', attempts int NOT NULL DEFAULT 0, claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz, seq bigserial
);
`;
