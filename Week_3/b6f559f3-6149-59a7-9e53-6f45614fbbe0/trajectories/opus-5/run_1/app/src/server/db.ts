import { Pool } from 'pg';
import type { PoolClient, QueryResultRow } from 'pg';
import { config } from './config';

export const pool = new Pool({ connectionString: config.databaseUrl, max: 10 });

let ready = false;

export function databaseReady(): boolean {
  return ready;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value text NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  owner_person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  status text NOT NULL,
  trashed_at timestamptz,
  purge_at timestamptz,
  imported boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS scenes (
  id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  order_index integer NOT NULL,
  settings jsonb NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE TABLE IF NOT EXISTS layers (
  id text NOT NULL,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scene_id text NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  parent_id text,
  order_index integer NOT NULL,
  visible boolean NOT NULL,
  locked boolean NOT NULL,
  mask_above boolean NOT NULL,
  blend_mode text NOT NULL,
  props jsonb NOT NULL,
  overrides jsonb NOT NULL,
  keyframes jsonb NOT NULL,
  events jsonb NOT NULL,
  bindings jsonb NOT NULL,
  PRIMARY KEY (project_id, id),
  FOREIGN KEY (project_id, scene_id) REFERENCES scenes(project_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS variables (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  type text NOT NULL,
  value jsonb NOT NULL,
  order_index integer NOT NULL,
  PRIMARY KEY (project_id, name)
);
CREATE TABLE IF NOT EXISTS presets (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  values jsonb NOT NULL,
  order_index integer NOT NULL,
  PRIMARY KEY (project_id, name)
);
CREATE TABLE IF NOT EXISTS members (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (project_id, person_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token text NOT NULL UNIQUE,
  status text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  invited_by text NOT NULL
);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  file_name text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL,
  width integer,
  height integer,
  vertices integer,
  clips jsonb NOT NULL,
  parsed jsonb,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS versions (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number integer NOT NULL,
  status text NOT NULL,
  published_at timestamptz NOT NULL,
  published_by text NOT NULL,
  sha256 text NOT NULL,
  bundle text NOT NULL,
  PRIMARY KEY (project_id, number)
);
CREATE TABLE IF NOT EXISTS op_history (
  id bigserial PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  person_id text NOT NULL,
  op_id text NOT NULL,
  scene_id text NOT NULL,
  seq integer NOT NULL,
  inverse jsonb NOT NULL,
  forward jsonb NOT NULL,
  undone boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency (
  scope text NOT NULL,
  key text NOT NULL,
  person_id text NOT NULL,
  body_hash text NOT NULL,
  status_code integer NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS layer_locks (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  layer_id text NOT NULL,
  person_id text NOT NULL,
  acquired_at timestamptz NOT NULL,
  last_change_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, layer_id)
);
CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL,
  project_id text,
  version_number integer,
  invite_id text,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  claimed_at timestamptz
);
CREATE INDEX IF NOT EXISTS layers_scene_idx ON layers(project_id, scene_id);
CREATE INDEX IF NOT EXISTS op_history_project_idx ON op_history(project_id, person_id);
CREATE INDEX IF NOT EXISTS outbox_status_idx ON outbox(status);
`;

export async function connectWithRetry(): Promise<void> {
  for (;;) {
    try {
      await pool.query('SELECT 1');
      await pool.query(SCHEMA);
      ready = true;
      return;
    } catch (error) {
      ready = false;
      process.stderr.write(`Waiting for PostgreSQL: ${(error as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
}

export async function query<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, params);
  return result.rows;
}

export async function queryOne<T extends QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await query<T>(text, params);
  return rows[0] ?? null;
}

export async function transaction<T>(handler: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await handler(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function resetDatabase(): Promise<void> {
  await pool.query(`
    TRUNCATE outbox, layer_locks, idempotency, op_history, versions, assets, invites, members,
      presets, variables, layers, scenes, projects, sessions, workspaces, people, settings;
  `);
}
