// PostgreSQL: the pool, transactions and the idempotent schema.
import { randomBytes } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value) => Number(value));
pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.PoolClient | pg.Pool;

export function newId(prefix: string): string {
  return `${prefix}-${randomBytes(9).toString("base64url")}`;
}

/** The row a statement always returns (an INSERT or UPDATE ... RETURNING on a row the caller holds). */
export function firstRow<T>(result: pg.QueryResult<T extends pg.QueryResultRow ? T : never>): T {
  const row = result.rows[0];
  if (row === undefined) throw new Error("statement returned no row");
  return row;
}

export async function inTransaction<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA_LOCK = 7_314_001;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS staff (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  role text NOT NULL CHECK (role IN ('survey_processor', 'vegetation_analyst')),
  access_code text NOT NULL UNIQUE,
  email text NOT NULL
);
CREATE TABLE IF NOT EXISTS staff_sessions (
  token_sha256 text PRIMARY KEY,
  staff_id text NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS utilities (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  name text NOT NULL,
  time_zone text NOT NULL,
  forester_name text NOT NULL,
  forester_email text NOT NULL
);
CREATE TABLE IF NOT EXISTS corridors (
  id text PRIMARY KEY,
  tenant_id text NOT NULL REFERENCES tenants(id),
  utility_id text NOT NULL REFERENCES utilities(id),
  name text NOT NULL,
  voltage_kv integer NOT NULL,
  clearance_threshold_m double precision NOT NULL,
  inspection_due date NOT NULL,
  tower1_lat_deg double precision NOT NULL,
  tower1_lon_deg double precision NOT NULL,
  azimuth_deg double precision NOT NULL,
  attachment_height_m double precision NOT NULL
);
CREATE TABLE IF NOT EXISTS towers (
  corridor_id text NOT NULL REFERENCES corridors(id),
  number integer NOT NULL,
  chainage_m double precision NOT NULL,
  lon_deg double precision NOT NULL,
  lat_deg double precision NOT NULL,
  base_height_m double precision NOT NULL,
  PRIMARY KEY (corridor_id, number)
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  corridor_id text NOT NULL REFERENCES corridors(id),
  kind text NOT NULL CHECK (kind IN ('tileset', 'terrain', 'czml')),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'stored', 'rejected')),
  rejected_reason text CHECK (rejected_reason IN ('checksum_mismatch', 'invalid_czml')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  stored_at timestamptz
);
CREATE INDEX IF NOT EXISTS assets_by_corridor ON assets (corridor_id, created_at DESC);
CREATE TABLE IF NOT EXISTS asset_files (
  asset_id text NOT NULL REFERENCES assets(id),
  position integer NOT NULL,
  path text NOT NULL,
  size_bytes bigint NOT NULL,
  sha256 text NOT NULL,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'stored', 'rejected')),
  PRIMARY KEY (asset_id, path)
);
CREATE TABLE IF NOT EXISTS flight_samples (
  asset_id text NOT NULL REFERENCES assets(id),
  seq integer NOT NULL,
  interval_index integer NOT NULL,
  time_ms double precision NOT NULL,
  lon_deg double precision NOT NULL,
  lat_deg double precision NOT NULL,
  height_m double precision NOT NULL,
  chainage_m double precision NOT NULL,
  PRIMARY KEY (asset_id, seq)
);
CREATE TABLE IF NOT EXISTS flight_coverage (
  asset_id text NOT NULL REFERENCES assets(id),
  from_m double precision NOT NULL,
  to_m double precision NOT NULL,
  PRIMARY KEY (asset_id, from_m)
);
CREATE TABLE IF NOT EXISTS findings_sets (
  id text PRIMARY KEY,
  corridor_id text NOT NULL REFERENCES corridors(id),
  revision integer NOT NULL,
  state text NOT NULL CHECK (state IN ('draft', 'submitted', 'under_review', 'accepted', 'disputed', 'closed')),
  previous_set_id text REFERENCES findings_sets(id),
  created_by text NOT NULL REFERENCES staff(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  submitted_at timestamptz,
  submitted_by text REFERENCES staff(id),
  frozen_finding_count integer,
  frozen_violation_count integer,
  last_label_number integer NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS findings_sets_one_open_per_corridor
  ON findings_sets (corridor_id) WHERE state <> 'closed';
CREATE TABLE IF NOT EXISTS findings (
  id text PRIMARY KEY,
  set_id text NOT NULL REFERENCES findings_sets(id),
  label_number integer NOT NULL,
  chainage_m double precision NOT NULL,
  offset_m double precision NOT NULL,
  lon_deg double precision NOT NULL,
  lat_deg double precision NOT NULL,
  ground_height_m double precision NOT NULL,
  terrain_level integer,
  canopy_height_m double precision NOT NULL,
  canopy_radius_m double precision NOT NULL,
  comment text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (set_id, label_number)
);
CREATE TABLE IF NOT EXISTS review_links (
  id text PRIMARY KEY,
  set_id text NOT NULL REFERENCES findings_sets(id),
  token text NOT NULL UNIQUE,
  minted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE INDEX IF NOT EXISTS review_links_by_set ON review_links (set_id, minted_at DESC);
CREATE TABLE IF NOT EXISTS decisions (
  set_id text NOT NULL REFERENCES findings_sets(id),
  finding_id text NOT NULL REFERENCES findings(id),
  decision text NOT NULL CHECK (decision IN ('accept', 'dispute')),
  note text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (set_id, finding_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  review_link_id text REFERENCES review_links(id),
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  lease_until timestamptz,
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_queued ON outbox (id) WHERE sent_at IS NULL;
CREATE INDEX IF NOT EXISTS outbox_by_link ON outbox (review_link_id, id DESC);
CREATE TABLE IF NOT EXISTS idempotency_records (
  scope text NOT NULL,
  route text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  response_body text,
  lease_until timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (scope, route, key)
);
`;

/** Applies the schema; several processes may start at once, so one advisory lock serialises them. */
export async function applySchema(): Promise<void> {
  await inTransaction(async (db) => {
    await db.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await db.query(SCHEMA);
  });
}
