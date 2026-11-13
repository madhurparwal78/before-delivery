-- Schema and seed, applied idempotently on each serve; several processes may start at once.

CREATE TABLE IF NOT EXISTS models (
  code text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('body','lens')),
  rated_lumens integer NOT NULL,
  rated_hours integer NOT NULL,
  native_width integer NOT NULL,
  native_height integer NOT NULL,
  rated_watts integer NOT NULL,
  ratio_min text,
  ratio_max text,
  shift_across_max text,
  shift_down_max text
);

CREATE TABLE IF NOT EXISTS units (
  serial text PRIMARY KEY,
  model_code text NOT NULL REFERENCES models(code),
  logged_hours text NOT NULL DEFAULT '0'
);

CREATE TABLE IF NOT EXISTS sites (
  id text PRIMARY KEY,
  name text NOT NULL,
  width_metres text NOT NULL,
  height_metres text NOT NULL,
  columns integer NOT NULL,
  rows integer NOT NULL,
  show_at timestamptz NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  residual_metres text,
  photo_sha256 text,
  photo_bytes bigint,
  photo_file_name text,
  photo_width_px integer,
  photo_height_px integer,
  photo_orientation integer,
  photo_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS layouts (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  version integer NOT NULL DEFAULT 0,
  layout_hash text NOT NULL DEFAULT '',
  sheet_status text NOT NULL DEFAULT 'Draft' CHECK (sheet_status IN ('Draft','Issued','Out of step','Withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS circuits (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  kind text NOT NULL,
  capacity_watts integer NOT NULL
);

CREATE TABLE IF NOT EXISTS cells (
  site_id text NOT NULL REFERENCES sites(id),
  name text NOT NULL,
  reflectance text NOT NULL DEFAULT '0.6',
  recess_metres text NOT NULL DEFAULT '0',
  PRIMARY KEY (site_id, name)
);

CREATE TABLE IF NOT EXISTS readings (
  id text PRIMARY KEY,
  site_id text NOT NULL REFERENCES sites(id),
  cell text NOT NULL,
  operation_id text NOT NULL,
  entered_text text NOT NULL,
  entered_unit text NOT NULL,
  canonical_lux text NOT NULL,
  captured_at timestamptz NOT NULL,
  counted_at timestamptz NOT NULL,
  accepted_at timestamptz NOT NULL,
  counts boolean NOT NULL DEFAULT true,
  UNIQUE (site_id, operation_id)
);

CREATE TABLE IF NOT EXISTS movements (
  id text PRIMARY KEY,
  kind text NOT NULL,
  serial text NOT NULL,
  at timestamptz NOT NULL,
  reverses_id text,
  reversed boolean NOT NULL DEFAULT false,
  from_location text NOT NULL,
  to_location text NOT NULL,
  logged_hours text
);

CREATE INDEX IF NOT EXISTS movements_serial_at_idx ON movements (serial, at, id);

CREATE TABLE IF NOT EXISTS movement_entries (
  id bigserial PRIMARY KEY,
  movement_id text NOT NULL REFERENCES movements(id),
  location text NOT NULL,
  delta integer NOT NULL CHECK (delta IN (-1, 1))
);

CREATE TABLE IF NOT EXISTS holds (
  id text PRIMARY KEY,
  status text NOT NULL,
  model text NOT NULL,
  "from" date NOT NULL,
  days integer NOT NULL,
  hold_ref text,
  serial text,
  logged_hours text,
  ask_key text UNIQUE,
  confirm_key text UNIQUE,
  expires_at timestamptz,
  server_arrival_at timestamptz,
  asked_answered boolean NOT NULL DEFAULT false,
  ask_settled boolean NOT NULL DEFAULT false,
  release_key text UNIQUE,
  release_sent boolean NOT NULL DEFAULT false,
  quote jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  scope text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  claimed_until timestamptz,
  PRIMARY KEY (key, scope)
);

CREATE TABLE IF NOT EXISTS placements (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES layouts(id),
  position integer NOT NULL,
  body_serial text,
  hold_id text,
  model text,
  lens_serial text NOT NULL,
  aim_across text NOT NULL,
  aim_down text NOT NULL,
  body_across text NOT NULL,
  body_down text NOT NULL,
  standoff text NOT NULL,
  ratio text NOT NULL,
  shift_across text NOT NULL,
  shift_down text NOT NULL,
  circuit_id text NOT NULL,
  UNIQUE (layout_id, body_serial),
  UNIQUE (layout_id, lens_serial)
);

CREATE TABLE IF NOT EXISTS sheets (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES layouts(id),
  version integer NOT NULL,
  status text NOT NULL DEFAULT 'Issued' CHECK (status IN ('Issued','Out of step','Withdrawn')),
  issued_at timestamptz NOT NULL,
  layout_hash text NOT NULL,
  layout_version integer NOT NULL,
  sha256 text NOT NULL,
  bytes bigint NOT NULL,
  key text NOT NULL,
  lowest_contrast text,
  withdrawn_at timestamptz,
  replacing_sheet_id text
);

CREATE UNIQUE INDEX IF NOT EXISTS sheets_layout_active_idx
  ON sheets (layout_id) WHERE status IN ('Issued','Out of step');

CREATE TABLE IF NOT EXISTS sheet_bindings (
  sheet_id text NOT NULL REFERENCES sheets(id),
  serial text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  PRIMARY KEY (sheet_id, serial)
);

CREATE UNIQUE INDEX IF NOT EXISTS sheet_bindings_serial_idx
  ON sheet_bindings (serial) WHERE active;

CREATE TABLE IF NOT EXISTS circuit_live (
  sheet_id text NOT NULL REFERENCES sheets(id),
  circuit_id text NOT NULL,
  live boolean NOT NULL,
  confirmed_at timestamptz NOT NULL,
  PRIMARY KEY (sheet_id, circuit_id)
);

CREATE TABLE IF NOT EXISTS links (
  token text PRIMARY KEY,
  sheet_id text NOT NULL REFERENCES sheets(id),
  ends_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS links_sheet_active_idx
  ON links (sheet_id) WHERE NOT revoked;

CREATE TABLE IF NOT EXISTS link_requests (
  token text NOT NULL,
  at timestamptz NOT NULL,
  PRIMARY KEY (token, at)
);

CREATE TABLE IF NOT EXISTS mask_jobs (
  id text PRIMARY KEY,
  layout_id text NOT NULL REFERENCES layouts(id),
  layout_hash text NOT NULL,
  phase text NOT NULL DEFAULT 'queued' CHECK (phase IN ('queued','rendering','storing','waiting_for_store','done','cancelled')),
  steps_done integer NOT NULL DEFAULT 0,
  steps_total integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sha256 text,
  key text
);

CREATE TABLE IF NOT EXISTS mask_steps (
  job_id text NOT NULL REFERENCES mask_jobs(id),
  position integer NOT NULL,
  serial text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','claimed','done')),
  claim_fence integer NOT NULL DEFAULT 0,
  claim_until timestamptz,
  claim_owner text,
  PRIMARY KEY (job_id, position)
);

CREATE TABLE IF NOT EXISTS outbox (
  sequence bigserial PRIMARY KEY,
  aggregate text NOT NULL,
  aggregate_id text NOT NULL,
  type text NOT NULL,
  data jsonb NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lapse_claims (
  hold_id text PRIMARY KEY,
  fence integer NOT NULL DEFAULT 0,
  claim_until timestamptz,
  owner text
);
