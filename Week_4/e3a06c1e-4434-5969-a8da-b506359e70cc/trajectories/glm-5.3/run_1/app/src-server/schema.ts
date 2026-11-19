// Schema applied idempotently on every start.

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS orgs (
  id UUID PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  name_folded TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'pilot' CHECK (plan IN ('pilot','scale')),
  billing_account_id TEXT,
  billing_subscription_id TEXT,
  billing_account_created BOOLEAN NOT NULL DEFAULT FALSE,
  billing_subscription_created BOOLEAN NOT NULL DEFAULT FALSE,
  seed BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS members (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email_folded TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','developer','reviewer','approver','billing')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, email_folded)
);

CREATE TABLE IF NOT EXISTS member_projects (
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  PRIMARY KEY (member_id, project_id)
);

CREATE TABLE IF NOT EXISTS sign_in_sessions (
  token TEXT PRIMARY KEY,
  member_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitations (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email_folded TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','developer','reviewer','approver','billing')),
  token TEXT NOT NULL UNIQUE,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitation_projects (
  invitation_id UUID NOT NULL REFERENCES invitations(id) ON DELETE CASCADE,
  project_id UUID NOT NULL,
  PRIMARY KEY (invitation_id, project_id)
);

CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  name_folded TEXT NOT NULL,
  monthly_quota_minutes INTEGER NOT NULL CHECK (monthly_quota_minutes >= 1 AND monthly_quota_minutes <= 1000000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  seed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (org_id, name_folded)
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prefix TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('live','replay')),
  source TEXT NOT NULL CHECK (source IN ('live','tone','upload')),
  label TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL CHECK (state IN ('connecting','live','closed','idle_closed','quota_halted','revoked')),
  close_reason TEXT CHECK (close_reason IN ('client','disconnect','end_of_audio','cap')),
  channels INTEGER NOT NULL CHECK (channels IN (1,2)),
  sample_rate INTEGER NOT NULL DEFAULT 16000,
  audio_ms INTEGER NOT NULL DEFAULT 0,
  frame INTEGER NOT NULL DEFAULT 0,
  plan TEXT NOT NULL CHECK (plan IN ('pilot','scale')),
  key_id UUID NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  live_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  billable_seconds INTEGER,
  billing_state TEXT NOT NULL DEFAULT 'open' CHECK (billing_state IN ('open','not_billable','pending','confirmed')),
  flagged_segments INTEGER NOT NULL DEFAULT 0,
  wer NUMERIC,
  storage_audio_bytes BIGINT NOT NULL DEFAULT 0,
  seed BOOLEAN NOT NULL DEFAULT FALSE,
  seed_source TEXT
);

-- Columns added by later schema versions are applied idempotently.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='flagged_segments') THEN
    ALTER TABLE sessions ADD COLUMN flagged_segments INTEGER NOT NULL DEFAULT 0;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='sessions' AND column_name='wer') THEN
    ALTER TABLE sessions ADD COLUMN wer NUMERIC;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS sessions_project_idx ON sessions (project_id);
CREATE INDEX IF NOT EXISTS sessions_state_idx ON sessions (state);
CREATE INDEX IF NOT EXISTS sessions_ended_idx ON sessions (ended_at);

CREATE TABLE IF NOT EXISTS spectrum_rows (
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  frame INTEGER NOT NULL,
  bins JSONB NOT NULL,
  peak_bin INTEGER NOT NULL,
  PRIMARY KEY (session_id, frame)
);

CREATE TABLE IF NOT EXISTS segments (
  id UUID PRIMARY KEY,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  index_in_session INTEGER NOT NULL,
  start_ms INTEGER NOT NULL,
  end_ms INTEGER NOT NULL,
  machine_words JSONB NOT NULL,
  UNIQUE (session_id, index_in_session)
);

CREATE TABLE IF NOT EXISTS corrections (
  id UUID PRIMARY KEY,
  segment_id UUID NOT NULL REFERENCES segments(id) ON DELETE CASCADE,
  session_id UUID NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  author_id UUID NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK (state IN ('draft','submitted','approved','returned')),
  text TEXT NOT NULL,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  decided_at TIMESTAMPTZ,
  decided_by UUID REFERENCES members(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS corrections_segment_idx ON corrections (segment_id);
CREATE INDEX IF NOT EXISTS corrections_state_idx ON corrections (state);

CREATE TABLE IF NOT EXISTS idempotency_records (
  member_id UUID NOT NULL,
  key_value TEXT NOT NULL,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  request_fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL,
  body BYTEA NOT NULL,
  content_type TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key_value)
);

CREATE TABLE IF NOT EXISTS plan_changes (
  id UUID PRIMARY KEY,
  org_id UUID NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('pilot','scale')),
  state TEXT NOT NULL CHECK (state IN ('requested','confirmed','failed')),
  requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS synthesis_jobs (
  id UUID PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  voice TEXT NOT NULL CHECK (voice IN ('lumen','basalt')),
  characters INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  render_key TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS trial_requests (
  id UUID PRIMARY KEY,
  email_folded TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  company TEXT NOT NULL,
  team TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
`;
