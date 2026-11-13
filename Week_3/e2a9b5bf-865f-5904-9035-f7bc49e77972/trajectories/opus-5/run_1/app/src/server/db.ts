import pg from 'pg';
import { config } from './config.js';

// Numerics come back as numbers: every numeric column here is a measurement.
pg.types.setTypeParser(1700, (value: string) => Number(value));
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  idleTimeoutMillis: 30_000,
});

export type Queryable = Pick<pg.PoolClient, 'query'>;

export async function query<T extends pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, values as unknown[]);
}

export async function withTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS signin_failures (
  id bigserial PRIMARY KEY,
  email text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS signin_failures_email_idx ON signin_failures (email, failed_at DESC);

CREATE TABLE IF NOT EXISTS signin_locks (
  email text PRIMARY KEY,
  locked_until timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS signin_sessions (
  id text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS telescopes (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  aperture_mm numeric NOT NULL,
  focal_length_mm numeric NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS telescopes_account_idx ON telescopes (account_id, seq);

CREATE TABLE IF NOT EXISTS eyepieces (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  focal_length_mm numeric NOT NULL,
  apparent_field_deg numeric NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS eyepieces_account_idx ON eyepieces (account_id, seq);

CREATE TABLE IF NOT EXISTS barlows (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  factor numeric NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS barlows_account_idx ON barlows (account_id, seq);

CREATE TABLE IF NOT EXISTS sites (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  name text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  time_zone text NOT NULL,
  seq bigserial
);
CREATE INDEX IF NOT EXISTS sites_account_idx ON sites (account_id, seq);

CREATE TABLE IF NOT EXISTS catalogue_objects (
  id text PRIMARY KEY,
  designation text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS observing_sessions (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  started_at timestamptz NOT NULL,
  optics jsonb NOT NULL,
  created_seq bigserial
);
CREATE INDEX IF NOT EXISTS observing_sessions_account_idx ON observing_sessions (account_id, started_at DESC);

CREATE TABLE IF NOT EXISTS observations (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  session_id uuid NOT NULL REFERENCES observing_sessions(id) ON DELETE CASCADE,
  object_id text NOT NULL REFERENCES catalogue_objects(id),
  observed_at timestamptz,
  seeing int,
  transparency_nelm numeric,
  concentration_class text,
  pair jsonb,
  description text NOT NULL DEFAULT '',
  optics jsonb NOT NULL,
  strokes_sha256 text,
  strokes_size int,
  strokes_has_marks boolean NOT NULL DEFAULT false,
  raster_sha256 text,
  version int NOT NULL DEFAULT 1,
  deleted boolean NOT NULL DEFAULT false,
  created_seq bigserial,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS observations_session_idx ON observations (session_id, observed_at);
CREATE INDEX IF NOT EXISTS observations_account_object_idx ON observations (account_id, object_id);

CREATE TABLE IF NOT EXISTS observation_field_edits (
  observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  field text NOT NULL,
  edited_at timestamptz NOT NULL,
  device text NOT NULL,
  set_at_version int NOT NULL,
  PRIMARY KEY (observation_id, field)
);

CREATE TABLE IF NOT EXISTS sync_results (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  client_op_id text NOT NULL,
  payload jsonb NOT NULL,
  status int NOT NULL,
  body jsonb,
  conflicts jsonb NOT NULL DEFAULT '[]'::jsonb,
  PRIMARY KEY (account_id, client_op_id)
);

CREATE TABLE IF NOT EXISTS programs (
  id text PRIMARY KEY,
  name text NOT NULL,
  required_count int NOT NULL,
  coordinator_name text NOT NULL,
  coordinator_email text NOT NULL,
  position int NOT NULL
);

CREATE TABLE IF NOT EXISTS program_editions (
  program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  edition int NOT NULL,
  effective_from date NOT NULL,
  min_description int NOT NULL,
  sketch_required boolean NOT NULL,
  concentration_required boolean NOT NULL,
  pair_required boolean NOT NULL,
  PRIMARY KEY (program_id, edition)
);

CREATE TABLE IF NOT EXISTS program_objects (
  program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  object_id text NOT NULL REFERENCES catalogue_objects(id),
  position int NOT NULL,
  PRIMARY KEY (program_id, object_id)
);

CREATE TABLE IF NOT EXISTS program_follows (
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  PRIMARY KEY (account_id, program_id)
);

CREATE TABLE IF NOT EXISTS packet_counters (
  account_id uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  next_number int NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS packets (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  number int NOT NULL,
  program_id text NOT NULL REFERENCES programs(id) ON DELETE CASCADE,
  state text NOT NULL,
  revision int NOT NULL DEFAULT 1,
  pdf jsonb,
  failure text,
  sent_at timestamptz,
  returned_to_draft boolean NOT NULL DEFAULT false,
  render_attempt uuid,
  render_started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, number)
);
CREATE INDEX IF NOT EXISTS packets_account_idx ON packets (account_id, created_at DESC);

CREATE TABLE IF NOT EXISTS packet_order (
  packet_id uuid NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  position int NOT NULL,
  observation_id uuid NOT NULL REFERENCES observations(id) ON DELETE CASCADE,
  PRIMARY KEY (packet_id, position)
);
CREATE INDEX IF NOT EXISTS packet_order_observation_idx ON packet_order (observation_id);

CREATE TABLE IF NOT EXISTS packet_snapshot (
  packet_id uuid NOT NULL REFERENCES packets(id) ON DELETE CASCADE,
  position int NOT NULL,
  observation_id uuid NOT NULL,
  designation text NOT NULL,
  evening_date text NOT NULL,
  edition int NOT NULL,
  strokes_sha256 text,
  PRIMARY KEY (packet_id, position)
);

CREATE TABLE IF NOT EXISTS storage_removals (
  id bigserial PRIMARY KEY,
  prefix text NOT NULL,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS seeded_strokes (
  observation_id uuid PRIMARY KEY REFERENCES observations(id) ON DELETE CASCADE,
  account_id uuid NOT NULL,
  sha256 text NOT NULL,
  body text NOT NULL,
  written boolean NOT NULL DEFAULT false
);
`;

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

export async function applySchema(seed: (client: pg.PoolClient) => Promise<void>): Promise<void> {
  const client = await pool.connect();
  try {
    // Two instances starting together must not race the schema or the seed.
    await client.query('SELECT pg_advisory_lock(7731201)');
    try {
      await client.query(SCHEMA);
      await seed(client);
    } finally {
      await client.query('SELECT pg_advisory_unlock(7731201)');
    }
    ready = true;
  } finally {
    client.release();
  }
}
