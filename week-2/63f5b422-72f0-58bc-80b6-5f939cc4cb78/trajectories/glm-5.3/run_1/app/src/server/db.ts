import pg from 'pg';
import { config } from './config.js';

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  document jsonb NOT NULL,
  seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS operations (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  op_id text,
  author_id text NOT NULL,
  author_name text NOT NULL,
  kind text NOT NULL,
  op jsonb NOT NULL,
  created jsonb,
  at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, seq)
);
CREATE TABLE IF NOT EXISTS op_acks (
  workspace_id text NOT NULL,
  author_id text NOT NULL,
  op_id text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (workspace_id, author_id, op_id)
);
CREATE TABLE IF NOT EXISTS undo_stacks (
  workspace_id text NOT NULL,
  user_id text NOT NULL,
  kind text NOT NULL,
  seq bigint NOT NULL,
  PRIMARY KEY (workspace_id, user_id, kind, seq)
);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  document jsonb NOT NULL,
  seq bigint NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  node_id text NOT NULL,
  node_name text NOT NULL,
  author_id text NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS comment_replies (
  id text PRIMARY KEY,
  thread_id text NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  author_id text NOT NULL,
  author_name text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  content_type text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  size integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS publishes (
  id text PRIMARY KEY,
  page_id text NOT NULL,
  workspace_id text NOT NULL,
  seq bigint NOT NULL,
  state text NOT NULL DEFAULT 'live',
  created_at timestamptz NOT NULL DEFAULT now(),
  html text,
  assets jsonb NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS publish_keys (
  key text NOT NULL,
  page_id text NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (key, page_id)
);
CREATE TABLE IF NOT EXISTS published_pages (
  id text PRIMARY KEY,
  workspace_id text NOT NULL,
  slug text NOT NULL,
  name text NOT NULL
);
`;

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

let schemaReady = false;

/** Applies the schema idempotently on start. */
export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  schemaReady = true;
}

export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastErr: unknown = null;
  while (Date.now() < deadline) {
    try {
      await pool.query('SELECT 1');
      await applySchema();
      return;
    } catch (err) {
      lastErr = err;
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  console.error('Postgres unreachable after 60s:', lastErr);
  process.exit(1);
}

export interface Tx {
  query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>>;
}
export const db: Tx = {
  async query<T extends pg.QueryResultRow = pg.QueryResultRow>(sql: string, params?: unknown[]) {
    if (!schemaReady) throw new Error('schema not applied');
    return pool.query<T>(sql, params);
  },
};
