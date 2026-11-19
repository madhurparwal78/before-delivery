import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { config } from './config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 10 });

let ready = false;
export function dbReady(): boolean {
  return ready;
}

export function id(): string {
  return randomBytes(12).toString('base64url');
}

export type Row = Record<string, unknown>;

export async function q<T extends object = Row>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params);
  return res.rows as T[];
}

export async function q1<T extends object = Row>(text: string, params: unknown[] = []): Promise<T | null> {
  const rows = await q<T>(text, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  username text UNIQUE NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  name text NOT NULL,
  explorers_schedule boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS sources (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  relation jsonb,
  hierarchy jsonb,
  entitlements jsonb NOT NULL DEFAULT '{"field":null,"users":{}}',
  schedule jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS source_tables (
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  ord integer NOT NULL,
  rows integer NOT NULL,
  sha256 text NOT NULL,
  object_key text NOT NULL,
  columns jsonb NOT NULL,
  PRIMARY KEY (source_id, name)
);
CREATE TABLE IF NOT EXISTS fields (
  id text PRIMARY KEY,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  table_name text NOT NULL,
  type text NOT NULL,
  kind text NOT NULL,
  continuous boolean NOT NULL,
  hidden boolean NOT NULL DEFAULT false,
  ord integer NOT NULL,
  derived jsonb
);
CREATE TABLE IF NOT EXISTS snapshots (
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  table_name text NOT NULL,
  rows jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, table_name)
);
CREATE TABLE IF NOT EXISTS extracts (
  source_id text PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'live',
  last_success_at timestamptz,
  last_failure_at timestamptz,
  last_run_at timestamptz,
  generation integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS workbooks (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  source_id text NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'draft',
  version integer NOT NULL DEFAULT 1,
  certified_by text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sheets (
  id text PRIMARY KEY,
  workbook_id text NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name text NOT NULL,
  spec jsonb NOT NULL,
  version integer NOT NULL DEFAULT 1,
  owner_id text REFERENCES users(id) ON DELETE CASCADE,
  copy_of text,
  ord integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS calculations (
  id text PRIMARY KEY,
  sheet_id text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name text NOT NULL,
  formula text NOT NULL,
  ord integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS parameters (
  id text PRIMARY KEY,
  workbook_id text NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  value jsonb,
  values_list jsonb NOT NULL DEFAULT '[]',
  ord integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sets (
  id text PRIMARY KEY,
  workbook_id text NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name text NOT NULL,
  field text NOT NULL,
  members jsonb,
  top jsonb,
  ord integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS dashboards (
  id text PRIMARY KEY,
  workbook_id text NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name text NOT NULL,
  spec jsonb NOT NULL,
  ord integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS alerts (
  id text PRIMARY KEY,
  sheet_id text NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  measure jsonb NOT NULL,
  above double precision NOT NULL,
  armed boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS inbox_items (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  read boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS export_jobs (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL,
  target_kind text NOT NULL,
  target_id text NOT NULL,
  request jsonb NOT NULL,
  fingerprint text NOT NULL,
  status text NOT NULL,
  progress integer NOT NULL DEFAULT 0,
  object_key text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS clock_state (
  id integer PRIMARY KEY,
  fixed_at timestamptz,
  offset_ms bigint NOT NULL DEFAULT 0
);
`;

export async function initDb(): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA);
      ready = true;
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
