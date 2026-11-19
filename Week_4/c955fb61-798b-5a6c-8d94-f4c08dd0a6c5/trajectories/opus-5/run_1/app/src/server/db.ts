import pg from 'pg';
import { config } from './config.js';

// Dates come back as the plain `YYYY-MM-DD` text they are stored as.
pg.types.setTypeParser(1082, (value: string) => value);
pg.types.setTypeParser(1700, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: readonly unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values as unknown[]);
  return result.rows;
}

export async function withTransaction<T>(run: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  capacity numeric NOT NULL DEFAULT 8,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  name text NOT NULL,
  group_id text REFERENCES items(id) ON DELETE SET NULL,
  position integer NOT NULL,
  chosen_start date,
  duration integer NOT NULL,
  percent integer NOT NULL DEFAULT 0,
  version integer NOT NULL DEFAULT 1,
  last_editor text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS links (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_item text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_item text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  type text NOT NULL,
  lag integer NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (project_id, date)
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
  author_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sequence bigserial
);

CREATE TABLE IF NOT EXISTS baselines (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  finish date,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS baseline_items (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  start_date date NOT NULL,
  end_date date NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigner_name text NOT NULL,
  send_after timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'queued'
);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format text NOT NULL,
  filename text NOT NULL,
  object_key text NOT NULL,
  state text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_project_idx ON items(project_id);
CREATE INDEX IF NOT EXISTS links_project_idx ON links(project_id);
CREATE INDEX IF NOT EXISTS comments_item_idx ON comments(item_id);
CREATE INDEX IF NOT EXISTS exports_project_idx ON exports(project_id);
`;

export async function applySchema(): Promise<void> {
  for (;;) {
    try {
      await pool.query(SCHEMA);
      return;
    } catch (error) {
      process.stderr.write(`waiting for postgres: ${(error as Error).message}\n`);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
