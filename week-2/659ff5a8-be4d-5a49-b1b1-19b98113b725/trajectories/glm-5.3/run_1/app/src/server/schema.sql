-- Schema for Conecount Paddock. Applied idempotently on every serve start.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  club_id TEXT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  is_operator BOOLEAN NOT NULL DEFAULT FALSE,
  staff_roles TEXT[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS clubs (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_club_fk;
ALTER TABLE users ADD CONSTRAINT users_club_fk FOREIGN KEY (club_id) REFERENCES clubs(id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS index_tables (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  effective_date DATE NOT NULL,
  factors JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by TEXT REFERENCES users(id),
  UNIQUE (club_id, effective_date)
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  name TEXT NOT NULL,
  date DATE NOT NULL,
  venue TEXT NOT NULL,
  registration_cutoff TIMESTAMPTZ NOT NULL,
  runs_per_driver INT NOT NULL,
  heat_classes JSONB NOT NULL,
  stations JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  running_heat INT,
  provisional_at TIMESTAMPTZ,
  protest_window_closes_at TIMESTAMPTZ,
  version INT NOT NULL DEFAULT 1,
  index_table_id TEXT NOT NULL REFERENCES index_tables(id),
  published_at TIMESTAMPTZ,
  results_checksum TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registrations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  driver_id TEXT NOT NULL REFERENCES users(id),
  class_code TEXT NOT NULL,
  car_number INT NOT NULL,
  car_description TEXT NOT NULL,
  run_heat INT NOT NULL,
  checked_in_at TIMESTAMPTZ,
  waiver_key TEXT,
  waiver_checksum TEXT,
  confirmation_email TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_id),
  UNIQUE (event_id, class_code, car_number)
);

CREATE TABLE IF NOT EXISTS stations (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  name TEXT NOT NULL,
  heat INT NOT NULL,
  registration_id TEXT REFERENCES registrations(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  registration_id TEXT NOT NULL REFERENCES registrations(id),
  run_number INT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  outcome TEXT,
  raw_time NUMERIC(7,3),
  cones INT,
  adjusted_time NUMERIC(8,3),
  indexed_time NUMERIC(8,3),
  factor NUMERIC(6,4),
  committed_at TIMESTAMPTZ,
  committed_by TEXT REFERENCES users(id),
  UNIQUE (registration_id, run_number)
);

CREATE TABLE IF NOT EXISTS run_rank_changes (
  registration_id TEXT NOT NULL,
  run_number INT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  indexed TEXT NOT NULL,
  class TEXT NOT NULL,
  raw TEXT NOT NULL,
  PRIMARY KEY (registration_id, run_number)
);

CREATE TABLE IF NOT EXISTS corrections (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  actor_id TEXT NOT NULL REFERENCES users(id),
  at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  before_outcome TEXT,
  before_raw_time NUMERIC(7,3),
  before_cones INT,
  before_adjusted NUMERIC(8,3),
  before_indexed NUMERIC(8,3),
  after_outcome TEXT NOT NULL,
  after_raw_time NUMERIC(7,3),
  after_cones INT,
  after_adjusted NUMERIC(8,3),
  after_indexed NUMERIC(8,3)
);

CREATE TABLE IF NOT EXISTS protests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id),
  filed_by TEXT NOT NULL REFERENCES users(id),
  subject_registration_id TEXT NOT NULL REFERENCES registrations(id),
  text TEXT NOT NULL,
  filed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  status TEXT NOT NULL DEFAULT 'pending',
  decision_note TEXT,
  decided_by TEXT REFERENCES users(id),
  decided_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS idempotency (
  user_id TEXT NOT NULL,
  key TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  status INT NOT NULL,
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  kind TEXT NOT NULL,
  registration_id TEXT REFERENCES registrations(id) ON DELETE SET NULL,
  event_id TEXT,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INT NOT NULL DEFAULT 0,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_failures (
  id TEXT PRIMARY KEY,
  club_id TEXT NOT NULL REFERENCES clubs(id),
  event_id TEXT,
  service TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_club ON events(club_id, date);
CREATE INDEX IF NOT EXISTS idx_regs_event ON registrations(event_id);
CREATE INDEX IF NOT EXISTS idx_stations_event ON stations(event_id);
CREATE INDEX IF NOT EXISTS idx_runs_reg ON runs(registration_id);
CREATE INDEX IF NOT EXISTS idx_corr_event ON corrections(run_id);
CREATE INDEX IF NOT EXISTS idx_idem_created ON idempotency(created_at);
CREATE INDEX IF NOT EXISTS idx_email_pending ON email_deliveries(status);
CREATE INDEX IF NOT EXISTS idx_failures_club ON delivery_failures(club_id, at);
