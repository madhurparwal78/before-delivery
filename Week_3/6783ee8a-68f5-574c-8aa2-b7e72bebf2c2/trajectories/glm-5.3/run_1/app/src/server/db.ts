import pg from "pg";
import { dbUrl } from "./config.ts";
import { logger } from "./logger.ts";

const pool = new pg.Pool({
  connectionString: dbUrl,
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 3_000,
});
pool.on("error", (err) => logger.error(`db pool error: ${err.message}`));

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tokens (
  token text PRIMARY KEY,
  kind text NOT NULL,
  user_id text,
  email text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notebooks (
  id text PRIMARY KEY,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  imported boolean NOT NULL DEFAULT false,
  execution_counter integer NOT NULL DEFAULT 0,
  working_saved boolean NOT NULL DEFAULT false,
  search_synced boolean NOT NULL DEFAULT false,
  modified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cells (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  id text NOT NULL,
  position integer NOT NULL,
  cell_type text NOT NULL,
  source text NOT NULL,
  revision integer NOT NULL DEFAULT 1,
  execution_count integer,
  run_state text NOT NULL DEFAULT 'idle',
  outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  outputs_version integer NOT NULL DEFAULT 1,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (notebook_id, id)
);
CREATE INDEX IF NOT EXISTS cells_order ON cells (notebook_id, position);

CREATE TABLE IF NOT EXISTS deleted_cells (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  id text NOT NULL,
  position integer NOT NULL,
  cell_type text NOT NULL,
  source text NOT NULL,
  outputs jsonb NOT NULL DEFAULT '[]'::jsonb,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  deleted_seq bigint NOT NULL,
  PRIMARY KEY (notebook_id, id)
);

CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (notebook_id, user_id)
);

CREATE TABLE IF NOT EXISTS invitations (
  token text PRIMARY KEY,
  share_id text NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS runs (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  run_id text NOT NULL,
  cell_id text NOT NULL,
  tab_id text NOT NULL,
  state text NOT NULL,
  prev_state text NOT NULL DEFAULT 'idle',
  execution_count integer,
  stored_response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notebook_id, run_id)
);

CREATE TABLE IF NOT EXISTS kernel_reports (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  tab_id text NOT NULL,
  status text NOT NULL,
  reported_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notebook_id, tab_id)
);

CREATE TABLE IF NOT EXISTS checkpoints (
  id text PRIMARY KEY,
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  number integer NOT NULL,
  label text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS checkpoints_order ON checkpoints (notebook_id, number DESC);

CREATE TABLE IF NOT EXISTS locks (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  cell_id text NOT NULL,
  tab_id text NOT NULL,
  holder_display_name text NOT NULL,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notebook_id, cell_id)
);

CREATE TABLE IF NOT EXISTS presence (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  tab_id text NOT NULL,
  user_id text NOT NULL,
  display_name text NOT NULL,
  cell_id text,
  last_seen timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notebook_id, tab_id)
);

CREATE TABLE IF NOT EXISTS attachments (
  notebook_id text NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
  cell_id text NOT NULL,
  name text NOT NULL,
  mime text NOT NULL,
  PRIMARY KEY (notebook_id, cell_id, name)
);
`;

export async function applySchema(): Promise<void> {
  await pool.query(SCHEMA);
  await pool.query("CREATE SEQUENCE IF NOT EXISTS deleted_seq");
  await pool.query(`ALTER TABLE runs ADD COLUMN IF NOT EXISTS prev_state text NOT NULL DEFAULT 'idle'`);
}

export async function connect(): Promise<pg.PoolClient> {
  return pool.connect();
}

type WithTx<T> = (client: pg.PoolClient) => Promise<T>;
export async function withTransaction<T>(fn: WithTx<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw err;
  } finally {
    client.release();
  }
}

export async function query<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(sql, params);
}

export async function one<T extends pg.QueryResultRow>(sql: string, params?: unknown[]): Promise<T | null> {
  const result = await pool.query<T>(sql, params);
  return result.rows[0] ?? null;
}
