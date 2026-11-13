export const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  packet_seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS signin_state (
  email text PRIMARY KEY,
  failures timestamptz[] NOT NULL DEFAULT '{}',
  locked_until timestamptz
);
CREATE TABLE IF NOT EXISTS catalogue_objects (
  id text PRIMARY KEY,
  position integer NOT NULL,
  designation text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL
);
CREATE TABLE IF NOT EXISTS programs (
  id text PRIMARY KEY,
  position integer NOT NULL,
  name text NOT NULL,
  required_count integer NOT NULL,
  coordinator_name text NOT NULL,
  coordinator_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS program_objects (
  program_id text NOT NULL REFERENCES programs(id),
  object_id text NOT NULL REFERENCES catalogue_objects(id),
  position integer NOT NULL,
  PRIMARY KEY (program_id, object_id)
);
CREATE TABLE IF NOT EXISTS program_editions (
  program_id text NOT NULL REFERENCES programs(id),
  edition integer NOT NULL,
  effective_from text NOT NULL,
  min_description integer NOT NULL,
  sketch_required boolean NOT NULL,
  concentration_required boolean NOT NULL,
  pair_required boolean NOT NULL,
  PRIMARY KEY (program_id, edition)
);
CREATE TABLE IF NOT EXISTS follows (
  account_id uuid NOT NULL REFERENCES accounts(id),
  program_id text NOT NULL REFERENCES programs(id),
  PRIMARY KEY (account_id, program_id)
);
CREATE TABLE IF NOT EXISTS telescopes (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  aperture_mm double precision NOT NULL,
  focal_length_mm double precision NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS eyepieces (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  focal_length_mm double precision NOT NULL,
  apparent_field_deg double precision NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS barlows (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  factor double precision NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  name text NOT NULL,
  latitude double precision NOT NULL,
  longitude double precision NOT NULL,
  time_zone text NOT NULL,
  seq bigserial
);
CREATE TABLE IF NOT EXISTS obs_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  site_id uuid NOT NULL REFERENCES sites(id),
  started_at timestamptz NOT NULL,
  evening_date text NOT NULL,
  local_start text NOT NULL,
  local_start_offset text NOT NULL,
  optics jsonb NOT NULL,
  derived jsonb NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS obs_sessions_account ON obs_sessions(account_id, started_at DESC);
CREATE TABLE IF NOT EXISTS observations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  session_id uuid NOT NULL REFERENCES obs_sessions(id),
  object_id text NOT NULL REFERENCES catalogue_objects(id),
  observed_at timestamptz,
  seeing integer,
  transparency_nelm double precision,
  concentration_class text,
  pair jsonb,
  description text NOT NULL DEFAULT '',
  optics jsonb NOT NULL,
  derived jsonb NOT NULL,
  sketch jsonb,
  sketch_marks integer NOT NULL DEFAULT 0,
  raster_sha text,
  version integer NOT NULL DEFAULT 1,
  field_meta jsonb NOT NULL DEFAULT '{}',
  deleted boolean NOT NULL DEFAULT false,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS observations_account_object ON observations(account_id, object_id) WHERE NOT deleted;
CREATE INDEX IF NOT EXISTS observations_session ON observations(session_id) WHERE NOT deleted;
CREATE TABLE IF NOT EXISTS sync_results (
  account_id uuid NOT NULL REFERENCES accounts(id),
  client_op_id text NOT NULL,
  payload text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  conflicts jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (account_id, client_op_id)
);
CREATE TABLE IF NOT EXISTS packets (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id),
  number integer NOT NULL,
  program_id text NOT NULL REFERENCES programs(id),
  state text NOT NULL,
  revision integer NOT NULL,
  observation_ids uuid[] NOT NULL,
  rows jsonb NOT NULL DEFAULT '[]',
  pdf jsonb,
  failure text,
  sent_at timestamptz,
  returned_to_draft boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  render_attempt uuid,
  state_since timestamptz NOT NULL DEFAULT now(),
  before_send jsonb,
  UNIQUE (account_id, number)
);
CREATE INDEX IF NOT EXISTS packets_account ON packets(account_id, number DESC);
CREATE TABLE IF NOT EXISTS pending_removals (
  key text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;
