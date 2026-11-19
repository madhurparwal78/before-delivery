-- Pensight schema. Applied idempotently on every start.

CREATE TABLE IF NOT EXISTS farms (
  id text PRIMARY KEY,
  name text NOT NULL,
  day_rate_amount bigint NOT NULL,
  day_rate_currency text NOT NULL
);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  UNIQUE (farm_id, code)
);

CREATE TABLE IF NOT EXISTS pens (
  id text PRIMARY KEY,
  farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  site_id text NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  pen_no bigint NOT NULL,
  name text NOT NULL,
  circumference_m double precision NOT NULL,
  net_depth_m double precision NOT NULL,
  grid_columns bigint NOT NULL,
  grid_rows bigint NOT NULL,
  UNIQUE (site_id, pen_no)
);

CREATE TABLE IF NOT EXISTS devices (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS defects (
  id text PRIMARY KEY,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  type text NOT NULL,
  bearing_deg double precision NOT NULL,
  depth_m double precision NOT NULL,
  chart_x_m double precision NOT NULL,
  chart_y_m double precision NOT NULL,
  cell text NOT NULL,
  size jsonb NOT NULL,
  area_cm2 double precision,
  patch_area_m2 double precision,
  note text NOT NULL DEFAULT '',
  private_note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'open',
  removed boolean NOT NULL DEFAULT false,
  version bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS defect_history (
  id bigserial PRIMARY KEY,
  defect_id text NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  at timestamptz NOT NULL,
  device_id text NOT NULL,
  device_name text NOT NULL,
  action text NOT NULL,
  changes jsonb NOT NULL DEFAULT '{}',
  detail text NOT NULL DEFAULT '',
  import_row bigint
);

CREATE TABLE IF NOT EXISTS repairs (
  id text PRIMARY KEY,
  defect_id text NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  method text NOT NULL,
  note text NOT NULL DEFAULT '',
  source text NOT NULL,
  proposal_id text,
  recorded_at timestamptz NOT NULL,
  device_id text NOT NULL,
  device_name text NOT NULL
);

CREATE TABLE IF NOT EXISTS stills (
  id text PRIMARY KEY,
  defect_id text NOT NULL REFERENCES defects(id) ON DELETE CASCADE,
  farm_id text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  file_name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS revisions (
  id bigserial PRIMARY KEY,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  number bigint NOT NULL,
  published_at timestamptz NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  grade_letter text NOT NULL,
  open_defects bigint NOT NULL,
  snapshot jsonb NOT NULL,
  UNIQUE (pen_id, number)
);

CREATE TABLE IF NOT EXISTS revision_still_links (
  revision_id bigint NOT NULL REFERENCES revisions(id) ON DELETE CASCADE,
  still_id text NOT NULL,
  defect_id text NOT NULL
);

CREATE TABLE IF NOT EXISTS report_links (
  id text PRIMARY KEY,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  token text NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

-- Every token a link ever had, so a regenerated-away token reads as inactive, not missing.
CREATE TABLE IF NOT EXISTS report_link_tokens (
  token text PRIMARY KEY,
  link_id text NOT NULL REFERENCES report_links(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS dives (
  id text PRIMARY KEY,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'planned',
  planned_start timestamptz NOT NULL,
  planned_minutes bigint NOT NULL,
  diver_certificate_no text NOT NULL,
  started_at timestamptz,
  finished_at timestamptz,
  clearance jsonb,
  clearance_checked_at timestamptz,
  clearance_issued_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS dive_track (
  id bigserial PRIMARY KEY,
  dive_id text NOT NULL REFERENCES dives(id) ON DELETE CASCADE,
  t_s bigint NOT NULL,
  bearing_deg double precision NOT NULL,
  depth_m double precision NOT NULL
);

CREATE TABLE IF NOT EXISTS sonar_captures (
  id text PRIMARY KEY,
  dive_id text NOT NULL REFERENCES dives(id) ON DELETE CASCADE,
  farm_id text NOT NULL,
  content_type text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  file_name text NOT NULL,
  uploaded_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS imports (
  id text PRIMARY KEY,
  farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  sha256 text NOT NULL,
  size_bytes bigint NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT now(),
  rows bigint NOT NULL,
  created jsonb NOT NULL DEFAULT '[]',
  merged jsonb NOT NULL DEFAULT '[]',
  already_imported jsonb NOT NULL DEFAULT '[]',
  orphans jsonb NOT NULL DEFAULT '[]',
  invalid jsonb NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS import_ledger (
  id bigserial PRIMARY KEY,
  farm_id text NOT NULL REFERENCES farms(id) ON DELETE CASCADE,
  fingerprint text NOT NULL,
  import_id text NOT NULL,
  row_no bigint NOT NULL,
  defect_id text NOT NULL,
  UNIQUE (farm_id, fingerprint)
);

CREATE TABLE IF NOT EXISTS copilot_answers (
  id text PRIMARY KEY,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  question text NOT NULL,
  text text NOT NULL DEFAULT '',
  focus jsonb NOT NULL DEFAULT '[]',
  dropped_ids jsonb NOT NULL DEFAULT '[]',
  rejected_calls jsonb NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proposals (
  id text PRIMARY KEY,
  answer_id text NOT NULL REFERENCES copilot_answers(id) ON DELETE CASCADE,
  defect_id text NOT NULL,
  method text NOT NULL,
  note text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'proposed',
  repair_id text,
  applied_at timestamptz
);

CREATE TABLE IF NOT EXISTS applied_proposals (
  proposal_id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now(),
  response jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS counters (
  name text PRIMARY KEY,
  next_value bigint NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_defects_pen ON defects(pen_id);
CREATE INDEX IF NOT EXISTS idx_history_defect ON defect_history(defect_id);
CREATE INDEX IF NOT EXISTS idx_revisions_pen ON revisions(pen_id);
CREATE INDEX IF NOT EXISTS idx_links_pen ON report_links(pen_id);
