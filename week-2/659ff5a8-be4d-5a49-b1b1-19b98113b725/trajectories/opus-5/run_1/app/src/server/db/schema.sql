CREATE TABLE IF NOT EXISTS clubs (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  time_zone text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  club_id uuid REFERENCES clubs(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  roles text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS index_tables (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  effective_date date NOT NULL,
  factors jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (club_id, effective_date)
);

CREATE TABLE IF NOT EXISTS events (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  name text NOT NULL,
  event_date date NOT NULL,
  venue text NOT NULL,
  registration_cutoff_local text NOT NULL,
  registration_cutoff_utc timestamptz NOT NULL,
  runs_per_driver int NOT NULL,
  heats jsonb NOT NULL,
  stations text[] NOT NULL,
  status text NOT NULL,
  running_heat int,
  provisional_at timestamptz,
  protest_window_closes_at timestamptz,
  version int NOT NULL DEFAULT 1,
  published_at timestamptz,
  results_checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS registrations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  driver_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  class_code text NOT NULL,
  car_number int NOT NULL,
  car_description text NOT NULL,
  run_heat int NOT NULL,
  checked_in boolean NOT NULL DEFAULT false,
  checked_in_at timestamptz,
  waiver_key text,
  waiver_checksum text,
  last_change_run_number int,
  last_change_at timestamptz,
  last_change_indexed text,
  last_change_class text,
  last_change_raw text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, driver_id),
  UNIQUE (event_id, class_code, car_number)
);

CREATE TABLE IF NOT EXISTS stations (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  heat int NOT NULL,
  name text NOT NULL,
  ordinal int NOT NULL,
  worker_registration_id uuid REFERENCES registrations(id) ON DELETE SET NULL,
  UNIQUE (event_id, heat, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS stations_one_per_event
  ON stations (event_id, worker_registration_id)
  WHERE worker_registration_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  run_number int NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  outcome text,
  raw_time_ms int,
  cones int,
  adjusted_ms int,
  indexed_ms int,
  factor_tt int,
  committed_at timestamptz,
  committed_by uuid REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE (registration_id, run_number)
);

CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY,
  run_id uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  before_values jsonb NOT NULL,
  after_values jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS protests (
  id uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  filed_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_registration_id uuid NOT NULL REFERENCES registrations(id) ON DELETE CASCADE,
  details text NOT NULL,
  filed_at timestamptz NOT NULL DEFAULT now(),
  status text NOT NULL DEFAULT 'pending',
  decision_note text,
  decided_by uuid REFERENCES users(id) ON DELETE SET NULL,
  decided_at timestamptz
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key text NOT NULL,
  endpoint text NOT NULL,
  body_hash text NOT NULL,
  response_status int NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, idempotency_key)
);

CREATE TABLE IF NOT EXISTS email_deliveries (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  registration_id uuid REFERENCES registrations(id) ON DELETE CASCADE,
  kind text NOT NULL,
  dedupe_key text NOT NULL UNIQUE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS delivery_failures (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  event_id uuid REFERENCES events(id) ON DELETE CASCADE,
  service text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS publications (
  event_id uuid PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  pdf_key text,
  checksum text,
  created_at timestamptz NOT NULL DEFAULT now()
);
