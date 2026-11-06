// Postgres: the system of record. Pool, transactions and the idempotent schema.
import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number(v));
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, idleTimeoutMillis: 30_000 });
pool.on("error", () => {
  /* a broken idle client is replaced on next checkout */
});

export type Db = pg.PoolClient | pg.Pool;

/** Each query names its row shape (see records.ts); a query that names none has unknown columns. */
type Shape = pg.QueryResultRow;
type Untyped = Record<string, unknown>;

export async function rows<T extends Shape = Untyped>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends Shape = Untyped>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

/** For a query that always yields exactly one row: an aggregate, or a key the caller already holds. */
export async function only<T extends Shape = Untyped>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  return (await db.query<T>(sql, params)).rows[0];
}

/** Runs `work` in one transaction; the client is always released, also when the caller's request is gone. */
export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS client_orgs (
  id text PRIMARY KEY, name text NOT NULL, time_zone text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, role text NOT NULL,
  client_org_id text REFERENCES client_orgs(id), units text NOT NULL DEFAULT 'metric',
  password_hash text NOT NULL, last_screen text);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  email text PRIMARY KEY, failures int NOT NULL DEFAULT 0, window_started_at timestamptz, locked_until timestamptz);
CREATE TABLE IF NOT EXISTS vessels (
  id text PRIMARY KEY, name text NOT NULL, seed_order int NOT NULL, ingest_key text NOT NULL UNIQUE,
  version int NOT NULL DEFAULT 1, afloat boolean NOT NULL DEFAULT false,
  thruster_hours_total double precision NOT NULL, hours_since_service double precision NOT NULL,
  service_interval_h double precision NOT NULL,
  last_fix_t timestamptz, last_fix_received_at timestamptz, last_easting double precision,
  last_northing double precision, last_heading double precision, last_speed double precision,
  last_battery double precision, last_depth double precision, last_fix_line_id text,
  link_observed text NOT NULL DEFAULT 'Lost', lost_spell_alerted timestamptz, overdue_alerted boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS missions (
  id text PRIMARY KEY, name text NOT NULL, client_org_id text NOT NULL REFERENCES client_orgs(id),
  survey_date text NOT NULL, status text NOT NULL, survey_order text NOT NULL,
  survey_area jsonb NOT NULL, geofence jsonb NOT NULL, planned_depth_m double precision NOT NULL,
  swath_ratio double precision NOT NULL, overlap_pct double precision NOT NULL,
  line_azimuth_deg double precision NOT NULL, planned_speed_mps double precision NOT NULL,
  swath_width_m double precision NOT NULL, line_spacing_m double precision NOT NULL,
  line_count int NOT NULL, crossline_count int NOT NULL, estimated_duration_s int NOT NULL,
  owner_id text NOT NULL REFERENCES users(id), version int NOT NULL DEFAULT 1,
  hold_reason text, hold_since timestamptz, hold_by text,
  created_at timestamptz NOT NULL, launched_at timestamptz, completed_at timestamptz,
  report_state text NOT NULL DEFAULT 'None', report_sha256 text, report_stored_at timestamptz);
CREATE TABLE IF NOT EXISTS mission_coverage (
  mission_id text PRIMARY KEY REFERENCES missions(id), coverage_pct double precision NOT NULL DEFAULT 0,
  compared int NOT NULL DEFAULT 0, within int NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS lines (
  id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id), label text NOT NULL,
  kind text NOT NULL, sort_key text NOT NULL, status text NOT NULL, rerun_of text, vessel_id text REFERENCES vessels(id),
  start_e double precision NOT NULL, start_n double precision NOT NULL,
  end_e double precision NOT NULL, end_n double precision NOT NULL, length_m double precision NOT NULL,
  offset_m double precision, holiday_id text, queue_pos int, file_state text,
  file_name text, file_size bigint, file_sha256 text, file_stored_at timestamptz,
  UNIQUE (mission_id, label));
CREATE INDEX IF NOT EXISTS lines_vessel ON lines (vessel_id, status);
CREATE TABLE IF NOT EXISTS fixes (
  vessel_id text NOT NULL REFERENCES vessels(id), t timestamptz NOT NULL, received_at timestamptz NOT NULL,
  easting double precision NOT NULL, northing double precision NOT NULL, heading_deg double precision NOT NULL,
  speed_mps double precision NOT NULL, battery_pct double precision NOT NULL, depth_m double precision NOT NULL,
  line_id text, PRIMARY KEY (vessel_id, t));
CREATE INDEX IF NOT EXISTS fixes_line ON fixes (line_id, t);
CREATE TABLE IF NOT EXISTS sweeps (
  id bigserial PRIMARY KEY, mission_id text NOT NULL, line_id text NOT NULL, ax double precision NOT NULL,
  ay double precision NOT NULL, bx double precision NOT NULL, by_ double precision NOT NULL,
  half_width double precision NOT NULL, depth_m double precision NOT NULL, length_m double precision NOT NULL);
CREATE INDEX IF NOT EXISTS sweeps_mission ON sweeps (mission_id);
CREATE TABLE IF NOT EXISTS holidays (
  id text PRIMARY KEY, mission_id text NOT NULL REFERENCES missions(id), label_no int NOT NULL,
  status text NOT NULL, cells jsonb NOT NULL, infill_line_id text, UNIQUE (mission_id, label_no));
CREATE TABLE IF NOT EXISTS excursions (
  id bigserial PRIMARY KEY, vessel_id text NOT NULL, mission_id text NOT NULL, alert_id text NOT NULL,
  ended_at timestamptz);
CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY, seq bigserial, kind text NOT NULL, state text NOT NULL, heading text NOT NULL,
  vessel_id text NOT NULL, mission_id text NOT NULL, raised_at timestamptz NOT NULL, rectified_at timestamptz,
  easting double precision, northing double precision, acknowledged_at timestamptz, acknowledged_by text,
  email_state text NOT NULL DEFAULT 'Queued', escalation_state text NOT NULL DEFAULT 'None', history jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS service_logs (
  id text PRIMARY KEY, seq bigserial, vessel_id text NOT NULL, logged_at timestamptz NOT NULL, logged_by text NOT NULL,
  hours_at_service double precision NOT NULL, note text NOT NULL);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL, endpoint text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
  status int, response jsonb, created_at timestamptz NOT NULL, PRIMARY KEY (user_id, endpoint, key));
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY, dedupe text NOT NULL UNIQUE, ref_kind text NOT NULL, ref_id text NOT NULL,
  recipient text NOT NULL, recipient_name text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL, sent_at timestamptz);
CREATE TABLE IF NOT EXISTS mission_events (
  seq bigserial PRIMARY KEY, mission_id text NOT NULL, at timestamptz NOT NULL, kind text NOT NULL,
  actor text NOT NULL, summary text NOT NULL);
CREATE INDEX IF NOT EXISTS mission_events_order ON mission_events (mission_id, at DESC, seq DESC);
CREATE TABLE IF NOT EXISTS flags (
  id text PRIMARY KEY, seq bigserial, mission_id text NOT NULL, line_id text NOT NULL, line_label text NOT NULL,
  comment text NOT NULL, by_user_id text NOT NULL, by_name text NOT NULL, at timestamptz NOT NULL,
  state text NOT NULL, reply_text text, reply_by text, reply_at timestamptz);
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY, line_id text NOT NULL, size_bytes bigint NOT NULL, sha256 text NOT NULL,
  received_bytes bigint NOT NULL DEFAULT 0, open boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS upload_parts (
  upload_id text NOT NULL, first_byte bigint NOT NULL, data bytea NOT NULL, PRIMARY KEY (upload_id, first_byte));
`;

export async function migrate(): Promise<void> {
  await tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(7461)");
    await client.query(SCHEMA);
  });
}

/** Waits for Postgres, retrying every two seconds. */
export async function connect(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      console.error("Postgres is not reachable yet; retrying in 2 s");
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
}
