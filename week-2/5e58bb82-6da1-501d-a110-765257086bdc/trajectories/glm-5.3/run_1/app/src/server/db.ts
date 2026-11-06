import pg from 'pg';
import { config } from './config.js';
import { derivePlan, Position, SurveyOrder } from './domain.js';

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

export async function withClient<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    return await fn(c);
  } finally {
    c.release();
  }
}

export async function inTx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch { /* connection gone */ }
    throw e;
  } finally {
    c.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS client_orgs (
  id text PRIMARY KEY,
  name text NOT NULL,
  time_zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL,
  client_org_id text,
  units text NOT NULL DEFAULT 'metric',
  last_screen text,
  seed text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sign_in_attempts (
  email text PRIMARY KEY,
  count int NOT NULL,
  window_start timestamptz NOT NULL,
  lock_until timestamptz
);
CREATE TABLE IF NOT EXISTS vessels (
  id text PRIMARY KEY,
  name text NOT NULL,
  seed_order int,
  ingest_key text NOT NULL,
  version int NOT NULL DEFAULT 1,
  afloat boolean NOT NULL DEFAULT false,
  thruster_hours_total double precision NOT NULL DEFAULT 0,
  hours_since_service double precision NOT NULL DEFAULT 0,
  service_interval_h double precision NOT NULL DEFAULT 250,
  seed text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS services (
  id text PRIMARY KEY,
  vessel_id text NOT NULL,
  logged_at timestamptz NOT NULL,
  logged_by text NOT NULL,
  hours_at_service double precision NOT NULL,
  note text NOT NULL
);
CREATE TABLE IF NOT EXISTS missions (
  id text PRIMARY KEY,
  name text NOT NULL,
  client_org_id text NOT NULL,
  survey_date date NOT NULL,
  status text NOT NULL,
  survey_order text NOT NULL,
  survey_area jsonb NOT NULL,
  geofence jsonb NOT NULL,
  planned_depth_m double precision NOT NULL,
  swath_ratio double precision NOT NULL,
  overlap_pct double precision NOT NULL,
  line_azimuth_deg double precision NOT NULL,
  planned_speed_mps double precision NOT NULL,
  swath_width_m double precision NOT NULL,
  line_spacing_m double precision NOT NULL,
  line_count int NOT NULL,
  crossline_count int NOT NULL,
  estimated_duration_s int NOT NULL,
  hold jsonb,
  version int NOT NULL DEFAULT 1,
  owner_id text NOT NULL,
  report_state text NOT NULL DEFAULT 'None',
  created_at timestamptz NOT NULL,
  launched_at timestamptz,
  completed_at timestamptz,
  report_generated_at timestamptz,
  seed text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS lines (
  id text PRIMARY KEY,
  mission_id text NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  status text NOT NULL,
  rerun_of text,
  vessel_id text,
  start jsonb NOT NULL,
  "end" jsonb NOT NULL,
  length_m double precision NOT NULL,
  covered_m double precision NOT NULL DEFAULT 0,
  holiday_id text,
  queue_seq int,
  seq int NOT NULL DEFAULT 0,
  file_name text,
  file_size_bytes bigint,
  file_sha256 text,
  file_stored_at timestamptz,
  seed text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS coverage_cells (
  mission_id text NOT NULL,
  col int NOT NULL,
  row int NOT NULL,
  lines jsonb NOT NULL DEFAULT '[]',
  PRIMARY KEY (mission_id, col, row)
);
CREATE TABLE IF NOT EXISTS cell_line_depth (
  mission_id text NOT NULL,
  col int NOT NULL,
  row int NOT NULL,
  line_id text NOT NULL,
  depth_sum double precision NOT NULL,
  pair_count int NOT NULL,
  PRIMARY KEY (mission_id, col, row, line_id)
);
CREATE TABLE IF NOT EXISTS holiday_cells (
  mission_id text NOT NULL,
  holiday_id text NOT NULL,
  col int NOT NULL,
  row int NOT NULL,
  PRIMARY KEY (holiday_id, col, row)
);
CREATE TABLE IF NOT EXISTS mission_counters (
  mission_id text PRIMARY KEY,
  coverage_pct double precision NOT NULL,
  open_holidays int NOT NULL,
  lines_remaining int NOT NULL,
  compared int NOT NULL DEFAULT 0,
  within int NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS mission_report (
  mission_id text PRIMARY KEY,
  bytes bytea NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS holidays (
  id text PRIMARY KEY,
  mission_id text NOT NULL,
  label text NOT NULL,
  status text NOT NULL,
  area_m2 double precision NOT NULL,
  cell_count int NOT NULL,
  centroid jsonb NOT NULL,
  infill_line_id text
);
CREATE TABLE IF NOT EXISTS alert_states (
  vessel_id text PRIMARY KEY,
  mission_id text,
  breach_alert_id text,
  lost_alert_id text,
  overdue_alert_id text,
  has_fix_since_launch boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  kind text NOT NULL,
  state text NOT NULL,
  heading text NOT NULL,
  vessel_id text NOT NULL,
  mission_id text NOT NULL,
  raised_at timestamptz NOT NULL,
  rectified_at timestamptz,
  position jsonb,
  acknowledged_at timestamptz,
  acknowledged_by text,
  acknowledged_by_name text,
  email text NOT NULL DEFAULT 'Queued',
  escalation text NOT NULL DEFAULT 'None',
  escalated_at timestamptz,
  condition text NOT NULL
);
CREATE TABLE IF NOT EXISTS alert_history (
  id bigserial PRIMARY KEY,
  alert_id text NOT NULL,
  state text NOT NULL,
  at timestamptz NOT NULL,
  by text NOT NULL
);
CREATE TABLE IF NOT EXISTS fixes (
  vessel_id text NOT NULL,
  t timestamptz NOT NULL,
  received_at timestamptz NOT NULL,
  easting double precision NOT NULL,
  northing double precision NOT NULL,
  heading_deg double precision NOT NULL,
  speed_mps double precision NOT NULL,
  battery_pct double precision NOT NULL,
  depth_m double precision NOT NULL,
  line_id text,
  PRIMARY KEY (vessel_id, t)
);
CREATE INDEX IF NOT EXISTS fixes_line_idx ON fixes (vessel_id, line_id, t);
CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  endpoint text NOT NULL,
  user_id text NOT NULL,
  body_hash text NOT NULL,
  status int NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (key, endpoint, user_id)
);
CREATE TABLE IF NOT EXISTS queued_emails (
  id text PRIMARY KEY,
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  dedupe_key text NOT NULL,
  ref_id text
);
CREATE UNIQUE INDEX IF NOT EXISTS queued_emails_dedupe ON queued_emails (dedupe_key, to_email);
CREATE TABLE IF NOT EXISTS mission_events (
  seq bigserial PRIMARY KEY,
  mission_id text NOT NULL,
  at timestamptz NOT NULL,
  kind text NOT NULL,
  actor text NOT NULL,
  summary text NOT NULL
);
CREATE TABLE IF NOT EXISTS flags (
  id text PRIMARY KEY,
  mission_id text NOT NULL,
  line_id text NOT NULL,
  by text NOT NULL,
  comment text NOT NULL,
  at timestamptz NOT NULL,
  state text NOT NULL,
  reply text,
  replied_at timestamptz
);
CREATE TABLE IF NOT EXISTS uploads (
  id text PRIMARY KEY,
  line_id text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  received_bytes bigint NOT NULL DEFAULT 0,
  parts bytea,
  finished boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS storage_status (
  id int PRIMARY KEY DEFAULT 1,
  storage_down_at timestamptz,
  mail_down_at timestamptz
);
INSERT INTO storage_status (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
`;

const SEED = `
INSERT INTO client_orgs (id, name, time_zone) VALUES
 ('org-calderhaven', 'Port of Calderhaven Authority', 'Europe/London'),
 ('org-saltmere', 'Saltmere Dredging Ltd', 'Europe/Amsterdam')
ON CONFLICT (id) DO NOTHING;

INSERT INTO users (id, name, email, password_hash, role, client_org_id, units, seed) VALUES
 ('u-ira', 'Ira Penhallow', 'ira@fathomwright.test', 'seed:chartroom-2026', 'principal_surveyor', NULL, 'metric', 'seed'),
 ('u-wren', 'Wren Calloway', 'wren@fathomwright.test', 'seed:chartroom-2026', 'principal_surveyor', NULL, 'metric', 'seed'),
 ('u-tamsin', 'Tamsin Rook', 'tamsin@fathomwright.test', 'seed:chartroom-2026', 'launch_technician', NULL, 'metric', 'seed'),
 ('u-odile', 'Odile Varga', 'odile@calderhaven-port.test', 'seed:chartroom-2026', 'client_reviewer', 'org-calderhaven', 'metric', 'seed'),
 ('u-bram', 'Bram Echols', 'bram@saltmere-dredging.test', 'seed:chartroom-2026', 'client_reviewer', 'org-saltmere', 'metric', 'seed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO vessels (id, name, seed_order, ingest_key, version, afloat, thruster_hours_total, hours_since_service, service_interval_h, seed) VALUES
 ('v-kittiwake', 'Kittiwake', 1, 'ik-kittiwake-4c19', 1, false, 1840.2, 112.4, 250, 'seed'),
 ('v-petrel', 'Petrel', 2, 'ik-petrel-8a03', 1, false, 960.0, 249.9, 250, 'seed'),
 ('v-shearwater', 'Shearwater', 3, 'ik-shearwater-2e77', 1, false, 2210.5, 263.5, 250, 'seed'),
 ('v-gannet', 'Gannet', 4, 'ik-gannet-61b5', 1, false, 310.0, 40.0, 300, 'seed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO missions (id, name, client_org_id, survey_date, status, survey_order, survey_area, geofence, planned_depth_m, swath_ratio, overlap_pct, line_azimuth_deg, planned_speed_mps, swath_width_m, line_spacing_m, line_count, crossline_count, estimated_duration_s, hold, version, owner_id, report_state, created_at, seed)
VALUES
 ('m-calderhaven-north', 'Calderhaven North Basin', 'org-calderhaven', '2026-11-02', 'Planned', 'special',
  '[{"easting":5000,"northing":8000},{"easting":5400,"northing":8000},{"easting":5400,"northing":8300},{"easting":5000,"northing":8300}]'::jsonb,
  '[{"easting":4950,"northing":7950},{"easting":5450,"northing":7950},{"easting":5450,"northing":8350},{"easting":4950,"northing":8350}]'::jsonb,
  10, 4, 20, 0, 2.0, 40, 32, 13, 1, 2930, NULL, 1, 'u-ira', 'None', '2026-11-02T08:00:00Z', 'seed'),
 ('m-saltmere-approach', 'Saltmere Approach Channel', 'org-saltmere', '2026-11-03', 'Planned', '1a',
  '[{"easting":1000,"northing":2000},{"easting":1120,"northing":2000},{"easting":1120,"northing":2600},{"easting":1000,"northing":2600}]'::jsonb,
  '[{"easting":950,"northing":1950},{"easting":1170,"northing":1950},{"easting":1170,"northing":2650},{"easting":950,"northing":2650}]'::jsonb,
  6, 4, 25, 0, 1.5, 24, 18, 7, 2, 3440, NULL, 1, 'u-ira', 'None', '2026-11-03T08:00:00Z', 'seed')
ON CONFLICT (id) DO NOTHING;

INSERT INTO mission_counters (mission_id, coverage_pct, open_holidays, lines_remaining, compared, within) VALUES
 ('m-calderhaven-north', 0, 0, 14, 0, 0),
 ('m-saltmere-approach', 0, 0, 9, 0, 0)
ON CONFLICT (mission_id) DO NOTHING;
`;

export async function migrate(): Promise<void> {
  await withClient(async (c) => {
    await c.query(SCHEMA);
    await c.query(SEED);
    // Seed missions get their derived lines inserted once, by id.
    const missions = await c.query(`SELECT * FROM missions WHERE seed = 'seed'`);
    for (const m of missions.rows) {
      const existing = await c.query(`SELECT count(*)::int AS n FROM lines WHERE mission_id = $1`, [m.id]);
      if (existing.rows[0]!.n > 0) continue;
      const plan = derivePlan(m.survey_area as Position[], {
        planned_depth_m: m.planned_depth_m as number,
        swath_ratio: m.swath_ratio as number,
        overlap_pct: m.overlap_pct as number,
        line_azimuth_deg: m.line_azimuth_deg as number,
        planned_speed_mps: m.planned_speed_mps as number,
        survey_order: m.survey_order as SurveyOrder,
      });
      let seq = 0;
      for (const l of [...plan.lines, ...plan.crosslines]) {
        await c.query(
          `INSERT INTO lines (id, mission_id, label, kind, status, start, "end", length_m, seq, seed)
           VALUES ($1,$2,$3,$4,'Pending',$5::jsonb,$6::jsonb,$7,$8,'seed')`,
          [`${m.id}-${l.label}`, m.id, l.label, l.kind, JSON.stringify(l.start), JSON.stringify(l.end), l.length_m, seq++]
        );
      }
    }
  });
}
