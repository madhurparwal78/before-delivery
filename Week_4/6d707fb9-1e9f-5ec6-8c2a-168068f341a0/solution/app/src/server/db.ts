import pg from "pg";
import { config } from "./config";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export type Queryable = Pick<pg.PoolClient, "query">;

/** A row as pg hands it back: each column is read at this third-party boundary and takes the type it is used as. */
export type DbRow = Record<string, never>;

export async function transaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Whole seconds: the server's own clock decides every time-dependent state. */
export function now(): Date {
  return new Date(Math.floor(Date.now() / 1000) * 1000);
}

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS assessors (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  ends_at timestamptz(0) NOT NULL,
  ended boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS labels (
  id text PRIMARY KEY,
  seq bigserial,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  name text NOT NULL,
  contact_name text,
  contact_email text,
  state text NOT NULL CHECK (state IN ('open', 'closed', 'erased')),
  closed_at timestamptz(0),
  erase_at timestamptz(0),
  erase_started boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS suppliers (
  id text PRIMARY KEY,
  seq bigserial,
  label_id text NOT NULL REFERENCES labels ON DELETE CASCADE,
  name text NOT NULL,
  town text NOT NULL,
  language text NOT NULL,
  contact_name text,
  contact_email text,
  UNIQUE (label_id, name)
);
CREATE TABLE IF NOT EXISTS styles (
  id text PRIMARY KEY,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  label_id text NOT NULL REFERENCES labels ON DELETE CASCADE,
  style_code text,
  name text NOT NULL,
  season text NOT NULL,
  gtin text NOT NULL,
  garment text NOT NULL,
  washes integer NOT NULL,
  repair_service boolean,
  range_size integer,
  notes text,
  state text NOT NULL CHECK (state IN ('draft', 'worked', 'published', 'archived')),
  version integer NOT NULL DEFAULT 1,
  changed_at timestamptz(0) NOT NULL,
  changed_by text,
  score_state text NOT NULL DEFAULT 'none' CHECK (score_state IN ('none', 'current', 'outdated')),
  score_id text,
  busy_until timestamptz(0),
  UNIQUE (label_id, style_code)
);
CREATE TABLE IF NOT EXISTS lines (
  id text PRIMARY KEY,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  position integer NOT NULL,
  material_id text NOT NULL,
  fabric_weight_gsm numeric,
  area_m2 numeric,
  mass_grams numeric NOT NULL,
  fibres jsonb NOT NULL,
  tier1 jsonb,
  tier2 jsonb,
  tier3 jsonb,
  energy_mj_per_kg numeric,
  water_litres_per_kg numeric,
  fibre_origin text
);
CREATE TABLE IF NOT EXISTS legs (
  id text PRIMARY KEY,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  position integer NOT NULL,
  mode text NOT NULL,
  km numeric NOT NULL
);
CREATE TABLE IF NOT EXISTS requests (
  id text PRIMARY KEY,
  seq bigserial,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  line_id text REFERENCES lines ON DELETE SET NULL,
  supplier_name text NOT NULL,
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  town text NOT NULL,
  language text NOT NULL,
  questions jsonb NOT NULL,
  due_date text NOT NULL,
  token text NOT NULL,
  sent_at timestamptz(0) NOT NULL,
  ends_at timestamptz(0) NOT NULL,
  ended boolean NOT NULL DEFAULT false,
  reminded_at timestamptz(0),
  answered_at timestamptz(0),
  answer jsonb
);
CREATE TABLE IF NOT EXISTS request_pages (
  token text PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS evidence (
  id text PRIMARY KEY,
  request_id text NOT NULL REFERENCES requests ON DELETE CASCADE,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  file_name text NOT NULL,
  size_bytes integer NOT NULL,
  content_type text NOT NULL,
  object_key text NOT NULL
);
CREATE TABLE IF NOT EXISTS visits (
  id text PRIMARY KEY,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  label_id text NOT NULL REFERENCES labels ON DELETE CASCADE,
  factory_name text NOT NULL,
  town text NOT NULL,
  local_date text NOT NULL,
  local_time text NOT NULL,
  at timestamptz(0) NOT NULL
);
CREATE TABLE IF NOT EXISTS readings (
  id text PRIMARY KEY,
  seq bigserial,
  visit_id text NOT NULL REFERENCES visits ON DELETE CASCADE,
  meter integer NOT NULL,
  value numeric NOT NULL,
  unit text NOT NULL,
  taken_at timestamptz(0) NOT NULL
);
CREATE TABLE IF NOT EXISTS reading_keys (
  visit_id text NOT NULL REFERENCES visits ON DELETE CASCADE,
  request_key text NOT NULL,
  body text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (visit_id, request_key)
);
CREATE TABLE IF NOT EXISTS results (
  id text PRIMARY KEY,
  seq bigserial,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  edition text NOT NULL,
  edition_valid_from text NOT NULL,
  worked_out_at timestamptz(0) NOT NULL,
  data_quality_percent integer NOT NULL,
  data_quality_grade text NOT NULL,
  measures jsonb NOT NULL,
  kept_rows jsonb NOT NULL,
  inputs jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS scenarios (
  id text PRIMARY KEY,
  seq bigserial,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  result_id text NOT NULL REFERENCES results ON DELETE CASCADE,
  name text NOT NULL,
  saved_at timestamptz(0) NOT NULL,
  changes jsonb NOT NULL,
  measures jsonb NOT NULL,
  differences jsonb NOT NULL
);
CREATE TABLE IF NOT EXISTS scores (
  id text PRIMARY KEY,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  body_key text NOT NULL,
  score integer NOT NULL,
  per100g integer NOT NULL,
  run_id text NOT NULL,
  worst_case_facts jsonb NOT NULL,
  UNIQUE (style_id, body_key)
);
CREATE TABLE IF NOT EXISTS passports (
  gtin text PRIMARY KEY,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  style_id text REFERENCES styles ON DELETE SET NULL,
  state text NOT NULL CHECK (state IN ('published', 'withdrawn'))
);
CREATE TABLE IF NOT EXISTS passport_editions (
  gtin text NOT NULL REFERENCES passports ON DELETE CASCADE,
  edition integer NOT NULL,
  published_at timestamptz(0) NOT NULL,
  snapshot jsonb NOT NULL,
  PRIMARY KEY (gtin, edition)
);
CREATE TABLE IF NOT EXISTS dossiers (
  id text PRIMARY KEY,
  seq bigserial,
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  style_id text NOT NULL REFERENCES styles ON DELETE CASCADE,
  result_id text NOT NULL REFERENCES results ON DELETE CASCADE,
  edition text NOT NULL,
  state text NOT NULL CHECK (state IN ('making', 'ready', 'signedOff', 'replaced')),
  made_at timestamptz(0) NOT NULL,
  signed_off_by text,
  signed_off_at timestamptz(0),
  pdf_stored boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS sign_off_pages (
  token text PRIMARY KEY,
  dossier_id text NOT NULL REFERENCES dossiers ON DELETE CASCADE,
  ends_at timestamptz(0) NOT NULL,
  ended boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY,
  label_id text NOT NULL REFERENCES labels ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_events (
  assessor_id text NOT NULL REFERENCES assessors ON DELETE CASCADE,
  kind text NOT NULL,
  at timestamptz(0) NOT NULL
);
CREATE INDEX IF NOT EXISTS rate_events_lookup ON rate_events (assessor_id, kind, at);
CREATE TABLE IF NOT EXISTS object_deletions (
  object_key text PRIMARY KEY,
  label_id text REFERENCES labels ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS editions_seen (
  edition text PRIMARY KEY,
  valid_from text NOT NULL
);
`;
