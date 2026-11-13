/**
 * Postgres access. The schema and start seed are applied idempotently every time the app serves.
 */
import { Pool, type PoolClient } from "pg";
import { config } from "./config";
import { ApiError, errors } from "./errors";
import { hashPassword } from "./auth";

export const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 20 });

export async function withDb<T>(fn: (db: PoolClient) => Promise<T>): Promise<T> {
  const db = await pool.connect();
  try {
    return await fn(db);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    if ((err as { code?: string }).code === "ECONNREFUSED" || (err as { code?: string }).code === "57P01") {
      throw errors.databaseUnavailable();
    }
    throw err;
  } finally {
    db.release();
  }
}

export async function dbHealthy(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  current_space TEXT,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS spaces (
  id BIGINT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  space_id BIGINT NOT NULL,
  user_id BIGINT NOT NULL,
  role TEXT NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE TABLE IF NOT EXISTS streams (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS generations (
  id BIGINT PRIMARY KEY,
  stream_id BIGINT NOT NULL,
  number INT NOT NULL,
  phase TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  rolled_over_at TIMESTAMPTZ,
  segment_key TEXT,
  segment_bytes BIGINT,
  UNIQUE (stream_id, number)
);
CREATE TABLE IF NOT EXISTS mappings (
  id BIGINT PRIMARY KEY,
  generation_id BIGINT NOT NULL,
  field TEXT NOT NULL,
  type TEXT NOT NULL,
  explicit BOOLEAN NOT NULL,
  UNIQUE (generation_id, field)
);
CREATE TABLE IF NOT EXISTS events (
  id BIGINT PRIMARY KEY,
  generation_id BIGINT NOT NULL,
  event_id TEXT NOT NULL,
  ts TIMESTAMPTZ NOT NULL,
  fields JSONB NOT NULL,
  pipeline TEXT,
  seq BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS events_g_ts ON events (generation_id, ts);
CREATE INDEX IF NOT EXISTS events_g_eid ON events (generation_id, event_id);
CREATE UNIQUE INDEX IF NOT EXISTS events_stream_eid ON events (generation_id, event_id);
CREATE TABLE IF NOT EXISTS terms (
  id BIGSERIAL PRIMARY KEY,
  generation_id BIGINT NOT NULL,
  field TEXT NOT NULL,
  token TEXT NOT NULL,
  positions INT[] NOT NULL,
  offsets INT[] NOT NULL,
  event_ids TEXT[] NOT NULL
);
CREATE INDEX IF NOT EXISTS terms_lookup ON terms (generation_id, field, token);
CREATE TABLE IF NOT EXISTS lifecycle_policy (
  stream_id TEXT PRIMARY KEY,
  rollover_max_age_ms BIGINT,
  rollover_max_events BIGINT,
  warm_after_ms BIGINT,
  archive_after_ms BIGINT,
  delete_after_ms BIGINT
);
CREATE TABLE IF NOT EXISTS failures (
  id BIGSERIAL PRIMARY KEY,
  stream_id BIGINT NOT NULL,
  reason TEXT NOT NULL,
  raw TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS pipelines (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  processors JSONB NOT NULL,
  UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS uploads (
  id BIGINT PRIMARY KEY,
  stream_id BIGINT NOT NULL,
  file TEXT NOT NULL,
  bytes BIGINT NOT NULL,
  sha256 TEXT NOT NULL,
  status TEXT NOT NULL,
  done_lines INT NOT NULL DEFAULT 0,
  total_lines INT NOT NULL DEFAULT 0,
  created INT NOT NULL DEFAULT 0,
  duplicates INT NOT NULL DEFAULT 0,
  dropped INT NOT NULL DEFAULT 0,
  failed INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS snapshots (
  id TEXT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  stream_id BIGINT NOT NULL,
  q TEXT NOT NULL,
  filters JSONB NOT NULL,
  sort TEXT,
  from_ms BIGINT NOT NULL,
  to_ms BIGINT NOT NULL,
  total INT NOT NULL,
  event_ids TEXT[] NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_used_at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS rules (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  stream_id BIGINT NOT NULL,
  filter JSONB,
  measure TEXT NOT NULL,
  measure_field TEXT,
  group_by TEXT,
  window_ms BIGINT NOT NULL,
  comparison TEXT NOT NULL,
  threshold DOUBLE PRECISION NOT NULL,
  frequency JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  last_check_at TIMESTAMPTZ,
  last_check_failed BOOLEAN NOT NULL DEFAULT FALSE,
  UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS rule_groups (
  id BIGINT PRIMARY KEY,
  rule_id BIGINT NOT NULL,
  "group" TEXT NOT NULL,
  state TEXT NOT NULL,
  since TIMESTAMPTZ NOT NULL,
  entered_at TIMESTAMPTZ NOT NULL,
  streak INT NOT NULL DEFAULT 0,
  snoozed_until TIMESTAMPTZ,
  snooze_kind TEXT,
  acknowledged_by TEXT,
  held_action BOOLEAN NOT NULL DEFAULT FALSE,
  history JSONB NOT NULL DEFAULT '[]',
  change_log JSONB NOT NULL DEFAULT '[]',
  last_action_at TIMESTAMPTZ,
  UNIQUE (rule_id, "group")
);
CREATE TABLE IF NOT EXISTS maintenance (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  time_zone TEXT NOT NULL,
  days TEXT NOT NULL,
  start TEXT NOT NULL,
  duration_ms BIGINT NOT NULL,
  rule_id BIGINT NOT NULL
);
CREATE TABLE IF NOT EXISTS inbox (
  id BIGSERIAL PRIMARY KEY,
  space_id BIGINT NOT NULL,
  rule_id BIGINT,
  rule_name TEXT NOT NULL,
  "group" TEXT NOT NULL,
  text TEXT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  acknowledged_by TEXT
);
CREATE TABLE IF NOT EXISTS cases (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  number INT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (space_id, number)
);
CREATE TABLE IF NOT EXISTS case_items (
  id BIGSERIAL PRIMARY KEY,
  case_id BIGINT NOT NULL,
  kind TEXT NOT NULL,
  ref TEXT NOT NULL,
  rule_name TEXT,
  "group" TEXT,
  inbox_text TEXT,
  at TIMESTAMPTZ NOT NULL
);
CREATE TABLE IF NOT EXISTS traces (
  id BIGSERIAL PRIMARY KEY,
  space_id BIGINT NOT NULL,
  trace_id TEXT NOT NULL,
  spans JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (space_id, trace_id)
);
CREATE TABLE IF NOT EXISTS objectives (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  service TEXT NOT NULL,
  name TEXT NOT NULL,
  stream_id BIGINT NOT NULL,
  target DOUBLE PRECISION NOT NULL,
  objective_window_ms BIGINT NOT NULL,
  bad JSONB NOT NULL,
  fixed_counts JSONB,
  UNIQUE (space_id, service)
);
CREATE TABLE IF NOT EXISTS saved_searches (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  stream TEXT NOT NULL,
  q TEXT NOT NULL,
  filters JSONB NOT NULL,
  from_ms BIGINT NOT NULL,
  to_ms BIGINT NOT NULL,
  UNIQUE (space_id, name)
);
CREATE TABLE IF NOT EXISTS api_keys (
  id BIGINT PRIMARY KEY,
  space_id BIGINT NOT NULL,
  name TEXT NOT NULL,
  stream_pattern TEXT NOT NULL,
  actions TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  last4 TEXT NOT NULL,
  expires_at TIMESTAMPTZ,
  revoked BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (space_id, name)
);
`;

let idCounter = 0;
const bootStamp = Date.now();
export function nextId(): string {
  idCounter += 1;
  // A monotonic id inside the BIGINT range: ms since 2026 boot plus a counter.
  return String(Number(BigInt(bootStamp % 100000000000) * 100000n + BigInt(idCounter % 100000) + BigInt(Math.floor(Math.random() * 90000) + 10000)));
}

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
}

