import type { Pool } from "pg";

// The app's schema. Applied idempotently on every serve, safe when several
// instances start together.
export const schemaStatements: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS objects (
    id text PRIMARY KEY,
    designation text NOT NULL,
    name text NOT NULL,
    kind text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS accounts (
    id uuid PRIMARY KEY,
    email text NOT NULL,
    email_normalised text NOT NULL UNIQUE,
    display_name text NOT NULL,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS signin_sessions (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    token_hash text NOT NULL,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS signin_failures (
    id bigserial PRIMARY KEY,
    email_normalised text NOT NULL,
    failed_at timestamptz NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS signin_failures_email_time ON signin_failures (email_normalised, failed_at)`,
  `CREATE TABLE IF NOT EXISTS telescopes (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    aperture_mm numeric NOT NULL,
    focal_length_mm numeric NOT NULL,
    position integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS eyepieces (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    focal_length_mm numeric NOT NULL,
    apparent_field_deg numeric NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS barlows (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    factor numeric NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS sites (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name text NOT NULL,
    latitude numeric NOT NULL,
    longitude numeric NOT NULL,
    time_zone text NOT NULL,
    position integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS observing_sessions (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    site_id uuid NOT NULL REFERENCES sites(id),
    started_at timestamptz NOT NULL,
    started_at_text text NOT NULL,
    evening_date text NOT NULL,
    local_start text NOT NULL,
    local_start_offset text NOT NULL,
    telescope_id uuid REFERENCES telescopes(id),
    eyepiece_id uuid REFERENCES eyepieces(id),
    barlow_id uuid REFERENCES barlows(id),
    train text NOT NULL,
    derived jsonb NOT NULL,
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS sessions_account_started ON observing_sessions (account_id, started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS observations (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    session_id uuid NOT NULL REFERENCES observing_sessions(id),
    object_id text NOT NULL,
    observed_at timestamptz,
    observed_at_text text,
    local_time text,
    local_offset text,
    evening_date text NOT NULL,
    seeing integer,
    transparency_nelm numeric,
    concentration_class text,
    pair_primary jsonb,
    pair_secondary jsonb,
    pair_separation numeric,
    pair_pa numeric,
    description text NOT NULL DEFAULT '',
    telescope_id uuid REFERENCES telescopes(id),
    eyepiece_id uuid REFERENCES eyepieces(id),
    barlow_id uuid REFERENCES barlows(id),
    train text NOT NULL,
    derived jsonb NOT NULL,
    strokes_sha256 text,
    strokes_size integer,
    raster_sha256 text,
    version integer NOT NULL DEFAULT 0,
    deleted boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE INDEX IF NOT EXISTS observations_account_session ON observations (account_id, session_id)`,
  `CREATE INDEX IF NOT EXISTS observations_account_object ON observations (account_id, object_id)`,
  `CREATE TABLE IF NOT EXISTS observation_field_edits (
    observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
    field text NOT NULL,
    edited_at_text text NOT NULL,
    edited_epoch_ms bigint NOT NULL,
    device text NOT NULL,
    PRIMARY KEY (observation_id, field)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_ops (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    client_op_id uuid NOT NULL,
    kind text NOT NULL,
    status integer NOT NULL,
    body jsonb NOT NULL,
    conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
    payload jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (account_id, client_op_id)
  )`,
  `CREATE TABLE IF NOT EXISTS programs (
    id text PRIMARY KEY,
    name text NOT NULL,
    required_count integer NOT NULL,
    coordinator_name text NOT NULL,
    coordinator_email text NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS program_objects (
    program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    object_id text NOT NULL,
    position integer NOT NULL,
    PRIMARY KEY (program_id, object_id)
  )`,
  `CREATE TABLE IF NOT EXISTS program_editions (
    program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    edition integer NOT NULL,
    effective_from text NOT NULL,
    min_description integer NOT NULL,
    sketch_required boolean NOT NULL,
    concentration_required boolean NOT NULL,
    pair_required boolean NOT NULL,
    PRIMARY KEY (program_id, edition)
  )`,
  `CREATE TABLE IF NOT EXISTS program_follows (
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
    PRIMARY KEY (account_id, program_id)
  )`,
  `CREATE TABLE IF NOT EXISTS packets (
    id uuid PRIMARY KEY,
    account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    program_id text NOT NULL REFERENCES programs(id),
    number integer NOT NULL,
    state text NOT NULL,
    revision integer NOT NULL DEFAULT 1,
    observation_ids jsonb NOT NULL DEFAULT '[]'::jsonb,
    rows jsonb NOT NULL DEFAULT '[]'::jsonb,
    pdf jsonb,
    failure text,
    sent_at timestamptz,
    sent_at_text text,
    returned_to_draft boolean NOT NULL DEFAULT false,
    created_at timestamptz NOT NULL DEFAULT now(),
    created_at_text text NOT NULL,
    UNIQUE (account_id, number)
  )`,
  `CREATE TABLE IF NOT EXISTS packet_render_attempts (
    id uuid PRIMARY KEY,
    packet_id uuid NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
    attempt integer NOT NULL,
    state text NOT NULL,
    started_at timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS storage_cleanup (
    id bigserial PRIMARY KEY,
    account_id uuid NOT NULL,
    prefix text NOT NULL,
    kind text NOT NULL,
    last_attempt timestamptz NOT NULL DEFAULT now()
  )`,
  `CREATE TABLE IF NOT EXISTS seed_markers (
    key text PRIMARY KEY,
    created_at timestamptz NOT NULL DEFAULT now()
  )`,
];

export async function applySchema(pool: Pool): Promise<void> {
  for (const statement of schemaStatements) {
    await pool.query(statement);
  }
}
