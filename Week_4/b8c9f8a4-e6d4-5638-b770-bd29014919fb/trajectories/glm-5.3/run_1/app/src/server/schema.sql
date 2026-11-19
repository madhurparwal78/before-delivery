-- Schema applied on every serve; safe to repeat and safe to run concurrently.
CREATE TABLE IF NOT EXISTS owner_session (
  token_hash text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS cars (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  registration text NOT NULL UNIQUE,
  asking_pounds integer NOT NULL,
  viewing_area text NOT NULL,
  home_address text NOT NULL,
  story text NOT NULL,
  listing_status text NOT NULL DEFAULT 'draft',
  current_version integer,
  pulled_at timestamptz,
  seed_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS readings (
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  panel_id text NOT NULL,
  microns integer NOT NULL,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (car_id, panel_id)
);

CREATE TABLE IF NOT EXISTS inspector_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  link_id uuid NOT NULL,
  client_id uuid NOT NULL,
  panel_id text NOT NULL,
  microns integer NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  payload_hash text NOT NULL,
  UNIQUE (link_id, client_id)
);

CREATE TABLE IF NOT EXISTS inspector_findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  link_id uuid NOT NULL,
  payload_hash text NOT NULL,
  client_id uuid NOT NULL,
  panel_id text NOT NULL,
  u double precision NOT NULL,
  v double precision NOT NULL,
  wording text NOT NULL,
  captured_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (link_id, client_id)
);

CREATE TABLE IF NOT EXISTS uploads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  kind text NOT NULL,
  file_name text NOT NULL,
  sha256 text NOT NULL,
  bytes integer NOT NULL,
  content_type text NOT NULL,
  derivative_sha256 text,
  location_removed boolean NOT NULL DEFAULT false,
  label text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS findings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  panel_id text NOT NULL,
  u double precision NOT NULL,
  v double precision NOT NULL,
  title text NOT NULL,
  wording text NOT NULL,
  severity text NOT NULL,
  photo_id uuid REFERENCES uploads(id),
  revision integer NOT NULL DEFAULT 1,
  position integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS record_pulls (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  pulled_at timestamptz NOT NULL DEFAULT now(),
  first_used_date text NOT NULL,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS advisory_responses (
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  advisory_key text NOT NULL,
  stance text NOT NULL,
  note text NOT NULL,
  answered_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (car_id, advisory_key)
);

CREATE TABLE IF NOT EXISTS versions (
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  number integer NOT NULL,
  published_at timestamptz NOT NULL DEFAULT now(),
  report_sha256 text NOT NULL,
  content jsonb NOT NULL,
  PRIMARY KEY (car_id, number)
);

CREATE TABLE IF NOT EXISTS links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  role text NOT NULL,
  name text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  last_seen_at timestamptz,
  seed_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS seen_records (
  link_id uuid NOT NULL REFERENCES links(id) ON DELETE CASCADE,
  finding_id text NOT NULL,
  finding_fingerprint text NOT NULL,
  seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (link_id, finding_id)
);

CREATE TABLE IF NOT EXISTS slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  starts_at timestamptz NOT NULL,
  duration_minutes integer NOT NULL,
  holder_link_id uuid REFERENCES links(id),
  seed_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  link_id uuid NOT NULL REFERENCES links(id),
  amount_pounds integer NOT NULL,
  status text NOT NULL DEFAULT 'open',
  stamped_at timestamptz NOT NULL DEFAULT now(),
  lapses_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  response_body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);

CREATE TABLE IF NOT EXISTS alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  car_id uuid NOT NULL REFERENCES cars(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'waiting',
  attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  delivered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_findings_car ON findings(car_id, position);
CREATE INDEX IF NOT EXISTS idx_seen_link ON seen_records(link_id);
CREATE INDEX IF NOT EXISTS idx_offers_car ON offers(car_id, status);
CREATE INDEX IF NOT EXISTS idx_alerts_state ON alerts(state);

CREATE TABLE IF NOT EXISTS app_config (
  key text PRIMARY KEY,
  value text NOT NULL
);

ALTER TABLE cars ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE alerts ADD COLUMN IF NOT EXISTS source_offer_id uuid;
CREATE INDEX IF NOT EXISTS idx_alerts_source_offer ON alerts(source_offer_id);

ALTER TABLE inspector_readings ADD COLUMN IF NOT EXISTS payload_hash text;
ALTER TABLE inspector_findings ADD COLUMN IF NOT EXISTS payload_hash text;
