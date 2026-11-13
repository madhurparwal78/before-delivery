import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(pg.types.builtins.DATE, (value) => value);
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
// An idle client losing its connection is reported here; the pool drops it and later queries open a fresh one.
pool.on("error", (error) => console.error("postgres idle client error:", error.message));

export type Queryable = Pick<pg.PoolClient, "query">;

export async function query<Row extends pg.QueryResultRow>(
  sql: string,
  params: readonly unknown[] = [],
  client: Queryable = pool,
): Promise<Row[]> {
  const result = await client.query<Row>(sql, [...params]);
  return result.rows;
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

const SCHEMA_LOCK = 4_173_001;
export const SEED_LOCK = 4_173_002;
export const SEARCH_LOCK = 4_173_003;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS deck_settings (
  id int PRIMARY KEY CHECK (id = 1),
  unit text NOT NULL CHECK (unit IN ('mm', 'in'))
);
CREATE TABLE IF NOT EXISTS zone_history (
  effective_from timestamptz PRIMARY KEY,
  zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS deck_reference (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  state text NOT NULL CHECK (state IN ('stored', 'trashed', 'purged')),
  version int NOT NULL,
  title text NOT NULL,
  maker text,
  year int,
  materials text[] NOT NULL,
  finish text NOT NULL,
  colour_family text NOT NULL,
  source_url text,
  source_note text NOT NULL,
  notes text NOT NULL,
  width_tenths int NOT NULL,
  height_tenths int NOT NULL,
  depth_tenths int NOT NULL,
  swatch text NOT NULL,
  swatch_source text NOT NULL CHECK (swatch_source IN ('computed', 'eyedropper')),
  captured_at timestamptz NOT NULL,
  trashed_at timestamptz,
  purge_at timestamptz,
  photo_content_type text NOT NULL,
  photo_bytes int NOT NULL,
  photo_sha256 text NOT NULL,
  photo_width int NOT NULL,
  photo_height int NOT NULL
);
CREATE INDEX IF NOT EXISTS deck_reference_listing ON deck_reference (state, captured_at DESC, seq DESC);
CREATE TABLE IF NOT EXISTS reel (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  name text NOT NULL,
  demo boolean NOT NULL,
  version int NOT NULL
);
CREATE TABLE IF NOT EXISTS reel_stop (
  reel_id text NOT NULL REFERENCES reel (id),
  reference_id text NOT NULL REFERENCES deck_reference (id),
  position int NOT NULL,
  PRIMARY KEY (reel_id, reference_id)
);
CREATE INDEX IF NOT EXISTS reel_stop_order ON reel_stop (reel_id, position);
CREATE TABLE IF NOT EXISTS contact_sheet (
  seq bigserial UNIQUE,
  id text PRIMARY KEY,
  reel_id text NOT NULL REFERENCES reel (id),
  reel_name text NOT NULL,
  state text NOT NULL CHECK (state IN ('queued', 'rendering', 'ready', 'failed')),
  paper text NOT NULL,
  unit text NOT NULL,
  requested_at timestamptz NOT NULL,
  ready_at timestamptz,
  pdf_bytes int,
  pdf_sha256 text,
  stops jsonb NOT NULL,
  failed_attempts int NOT NULL DEFAULT 0,
  lease_until timestamptz
);
CREATE TABLE IF NOT EXISTS daily_pull (
  pull_day date PRIMARY KEY,
  reference_id text NOT NULL REFERENCES deck_reference (id),
  picked_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_record (
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  state text NOT NULL CHECK (state IN ('hold', 'done')),
  content_hash text NOT NULL,
  status int,
  body jsonb,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (key, method, path)
);
CREATE TABLE IF NOT EXISTS search_update (
  seq bigserial PRIMARY KEY,
  reference_id text NOT NULL
);
INSERT INTO deck_settings (id, unit) VALUES (1, 'mm') ON CONFLICT DO NOTHING;
INSERT INTO zone_history (effective_from, zone) VALUES ('2024-01-01T00:00:00Z', 'Europe/London') ON CONFLICT DO NOTHING;
`;

/** Applies the schema and the settings at start, once even when copies start together. */
export async function migrate(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
  });
}
