// The schema, applied idempotently on every start under the schema advisory lock.

export const SCHEMA = `
CREATE OR REPLACE FUNCTION epoch(t timestamptz) RETURNS int8
  LANGUAGE sql IMMUTABLE AS $$ SELECT extract(epoch FROM t)::int8 $$;

CREATE TABLE IF NOT EXISTS seed_marker (
  name text PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  org_role text NOT NULL CHECK (org_role IN ('admin', 'steward', 'member')),
  password_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  slug text PRIMARY KEY,
  name text NOT NULL,
  kind text NOT NULL,
  code text NOT NULL UNIQUE,
  floor_tenths int NOT NULL CHECK (floor_tenths BETWEEN 0 AND 1000),
  buffer_tenths int NOT NULL CHECK (buffer_tenths BETWEEN 0 AND 1000),
  lead_person_id text NOT NULL REFERENCES people(id),
  boundary jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS sensors (
  id text PRIMARY KEY,
  project text NOT NULL REFERENCES projects(slug),
  kind text NOT NULL CHECK (kind IN ('tower', 'satellite')),
  polygon jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  person_id text NOT NULL REFERENCES people(id),
  project text NOT NULL REFERENCES projects(slug),
  role text NOT NULL CHECK (role IN ('viewer', 'analyst', 'sealer')),
  PRIMARY KEY (person_id, project)
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS batches (
  id uuid PRIMARY KEY,
  project text NOT NULL REFERENCES projects(slug),
  received_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS readings (
  sensor_id text NOT NULL REFERENCES sensors(id),
  interval_start timestamptz NOT NULL,
  project text NOT NULL REFERENCES projects(slug),
  fc_e4 int NOT NULL CHECK (fc_e4 BETWEEN -1000000 AND 1000000),
  fch4_e4 int NOT NULL CHECK (fch4_e4 BETWEEN -10000000 AND 50000000),
  qc smallint NOT NULL CHECK (qc BETWEEN 0 AND 3),
  PRIMARY KEY (sensor_id, interval_start)
);
CREATE INDEX IF NOT EXISTS readings_project_time ON readings (project, interval_start);

CREATE TABLE IF NOT EXISTS revisions (
  id bigserial PRIMARY KEY,
  project text NOT NULL REFERENCES projects(slug),
  sensor_id text NOT NULL,
  interval_start timestamptz NOT NULL,
  old_fc_e4 int,
  old_fch4_e4 int,
  old_qc smallint,
  new_fc_e4 int NOT NULL,
  new_fch4_e4 int NOT NULL,
  new_qc smallint NOT NULL,
  batch_id uuid NOT NULL REFERENCES batches(id),
  revised_at timestamptz NOT NULL,
  FOREIGN KEY (sensor_id, interval_start) REFERENCES readings(sensor_id, interval_start)
);
CREATE INDEX IF NOT EXISTS revisions_reading ON revisions (sensor_id, interval_start);

CREATE TABLE IF NOT EXISTS figures (
  id text PRIMARY KEY,
  project text NOT NULL REFERENCES projects(slug),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL CHECK (start_at < end_at),
  sensor_ids text[] NOT NULL,
  status text NOT NULL CHECK (status IN ('sealed', 'broken', 'superseded')),
  supersedes text UNIQUE REFERENCES figures(id),
  superseded_by text UNIQUE REFERENCES figures(id),
  coverage_tenths int NOT NULL,
  floor_tenths int NOT NULL,
  buffer_tenths int NOT NULL,
  net_milli int8 NOT NULL,
  co2_milli int8 NOT NULL,
  ch4_milli int8 NOT NULL,
  buffer_milli int8 NOT NULL,
  credited_milli int8 NOT NULL,
  readings_count int NOT NULL,
  fingerprint text NOT NULL CHECK (fingerprint ~ '^[0-9a-f]{64}$'),
  contributions jsonb NOT NULL,
  sealed_at timestamptz NOT NULL,
  sealed_by text NOT NULL REFERENCES people(id),
  checked_at timestamptz NOT NULL,
  revision_watermark int8 NOT NULL,
  CHECK ((status = 'superseded') = (superseded_by IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS figures_project ON figures (project, status);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id bigserial PRIMARY KEY,
  project text NOT NULL REFERENCES projects(slug),
  figure_id text NOT NULL REFERENCES figures(id),
  kind text NOT NULL CHECK (kind IN ('issuance', 'buffer', 'reversal')),
  tco2e_milli int8 NOT NULL,
  reverses int8 UNIQUE REFERENCES ledger_entries(id),
  recorded_at timestamptz NOT NULL,
  CHECK ((kind = 'reversal') = (reverses IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS ledger_project ON ledger_entries (project, id);

CREATE TABLE IF NOT EXISTS idempotency_records (
  person_id text NOT NULL REFERENCES people(id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status int NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (person_id, key)
);

CREATE TABLE IF NOT EXISTS regulator_links (
  id uuid PRIMARY KEY,
  figure_id text NOT NULL REFERENCES figures(id),
  token text NOT NULL UNIQUE,
  issued_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS regulator_links_figure ON regulator_links (figure_id, issued_at);

CREATE TABLE IF NOT EXISTS broken_seal_alerts (
  id bigserial PRIMARY KEY,
  figure_id text NOT NULL UNIQUE REFERENCES figures(id),
  recipients text[] NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  queued_at timestamptz NOT NULL,
  sent_at timestamptz
);
`;
