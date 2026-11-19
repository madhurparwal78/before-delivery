import { randomUUID } from "node:crypto";
import pg from "pg";
import { settings } from "./config";

pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(1700, (value: string) => Number(value));
pg.types.setTypeParser(20, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: settings.databaseUrl, max: 12 });

export type Db = pg.PoolClient | pg.Pool;

export const newId = (): string => randomUUID();

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  capacity numeric NOT NULL DEFAULT 8
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_order bigserial,
  PRIMARY KEY (workspace_id, user_id)
);
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  baseline_name text,
  baseline_finish date
);
CREATE TABLE IF NOT EXISTS holidays (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  on_date date NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (project_id, on_date)
);
CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  position integer NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  group_id text REFERENCES items(id) ON DELETE SET NULL,
  chosen_start date,
  duration integer NOT NULL,
  percent integer NOT NULL,
  version integer NOT NULL DEFAULT 1,
  updated_by text NOT NULL REFERENCES users(id),
  baseline_start date,
  baseline_end date
);
CREATE INDEX IF NOT EXISTS items_project ON items(project_id);
CREATE TABLE IF NOT EXISTS links (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type text NOT NULL,
  lag integer NOT NULL,
  UNIQUE (from_id, to_id)
);
CREATE TABLE IF NOT EXISTS assignments (
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours numeric NOT NULL,
  PRIMARY KEY (item_id, user_id)
);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id),
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  assignee_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hours numeric NOT NULL,
  attempt_at timestamptz NOT NULL,
  sent_at timestamptz
);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format text NOT NULL,
  filename text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
`;

/** Applies the schema idempotently, retrying every 2 seconds until Postgres answers. */
export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(727001)");
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock(727001)");
      } finally {
        client.release();
      }
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

export async function inTransaction<T>(work: (tx: pg.PoolClient) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK");
    throw error;
  } finally {
    tx.release();
  }
}
