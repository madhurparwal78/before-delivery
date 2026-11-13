// Postgres schema and migration-free idempotent application at serve time.
// Postgres is the system of record and the only arbiter of every single winner.

import type { Pool } from "pg";

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS "references" (
  id text PRIMARY KEY,
  state text NOT NULL DEFAULT 'stored',
  version integer NOT NULL DEFAULT 1,
  title text NOT NULL,
  maker text,
  year integer,
  materials text[] NOT NULL DEFAULT '{}',
  finish text,
  colour_family text NOT NULL,
  source_url text,
  source_note text,
  notes text,
  width_tenths integer NOT NULL,
  height_tenths integer NOT NULL,
  depth_tenths integer NOT NULL,
  swatch text NOT NULL,
  swatch_source text NOT NULL DEFAULT 'computed',
  captured_at timestamptz NOT NULL,
  trashed_at timestamptz,
  purge_at timestamptz,
  photo_content_type text NOT NULL,
  photo_bytes bigint NOT NULL,
  photo_sha256 text NOT NULL,
  photo_width integer NOT NULL,
  photo_height integer NOT NULL,
  photo_orientation integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS reels (
  id text PRIMARY KEY,
  name text NOT NULL,
  demo boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reel_stops (
  reel_id text NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  position integer NOT NULL,
  reference_id text NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  PRIMARY KEY (reel_id, position)
);

CREATE TABLE IF NOT EXISTS sheets (
  id text PRIMARY KEY,
  reel_id text NOT NULL REFERENCES reels(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'queued',
  paper text NOT NULL,
  unit text NOT NULL,
  requested_at timestamptz NOT NULL,
  ready_at timestamptz,
  pdf_bytes bigint,
  pdf_sha256 text,
  stops jsonb NOT NULL,
  fail_count integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS daily_pulls (
  pull_day date PRIMARY KEY,
  reference_id text NOT NULL REFERENCES "references"(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS settings (
  singleton boolean PRIMARY KEY DEFAULT true,
  home_history jsonb NOT NULL,
  pending_zone jsonb,
  unit text NOT NULL DEFAULT 'mm'
);

CREATE TABLE IF NOT EXISTS idempotency (
  key text NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  state text NOT NULL DEFAULT 'hold',
  request_hash text,
  response_status integer,
  response_body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (method, path, key)
);

CREATE TABLE IF NOT EXISTS search_updates (
  seq bigserial PRIMARY KEY,
  reference_id text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS references_captured_idx ON "references" (captured_at DESC);
`;

export async function applySchema(pool: Pool): Promise<void> {
  await pool.query(SCHEMA_SQL);
  // Apply defaults added after the first serve; CREATE TABLE IF NOT EXISTS
  // does not change an existing table.
  await pool.query(
    `ALTER TABLE "references" ALTER COLUMN photo_orientation SET DEFAULT 1`,
  ).catch(() => undefined);
}
