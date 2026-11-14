import pg from "pg";
import { config } from "./config.js";
import { fail } from "./errors.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  connectionTimeoutMillis: 2000,
  idleTimeoutMillis: 10000,
});
pool.on("error", () => {
  // Idle clients that lose their connection are discarded; the next query opens a fresh one.
});

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  display_name text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sign_in_codes (
  email_key text PRIMARY KEY,
  code text NOT NULL,
  display_name text,
  expires_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  name text NOT NULL,
  text text NOT NULL,
  last_valid_text text NOT NULL,
  layout jsonb NOT NULL,
  revision integer NOT NULL,
  error_count integer NOT NULL,
  created_at timestamptz NOT NULL,
  updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS edits (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  text text NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, revision)
);
CREATE TABLE IF NOT EXISTS versions (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  number integer NOT NULL,
  name text NOT NULL,
  text text NOT NULL,
  layout jsonb NOT NULL,
  revision integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,
  restored_from integer,
  PRIMARY KEY (project_id, number)
);
CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  access text NOT NULL,
  status text NOT NULL,
  email text,
  invitation_status text,
  invitation_sent_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  replaced_by uuid
);
CREATE TABLE IF NOT EXISTS members (
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL,
  joined_via uuid,
  joined_at timestamptz NOT NULL,
  removed_at timestamptz,
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  dialect text NOT NULL,
  status text NOT NULL,
  object_key text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  file_name text NOT NULL,
  revision integer NOT NULL,
  download_expires_at timestamptz,
  created_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS exports_user_created_idx ON exports (user_id, created_at);
CREATE TABLE IF NOT EXISTS imports (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  dialect text NOT NULL,
  mode text NOT NULL,
  object_key text NOT NULL,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL
);
`;

let ready = false;

/** Applies the schema, retrying every 2 seconds until PostgreSQL answers. */
export function startSchema(): void {
  const attempt = async () => {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(746921)");
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock(746921)");
      } finally {
        client.release();
      }
      ready = true;
    } catch (error) {
      console.error(`PostgreSQL schema not applied yet: ${(error as Error).message}`);
      setTimeout(attempt, 2000);
    }
  };
  void attempt();
}

export type Queryable = Pick<pg.PoolClient, "query">;

function ensureReady(): void {
  if (!ready) throw fail.database();
}

export async function query<R extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<R[]> {
  ensureReady();
  const result = await pool.query<R>(sql, params);
  return result.rows;
}

export async function transaction<T>(work: (client: Queryable) => Promise<T>): Promise<T> {
  ensureReady();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const value = await work(client);
    await client.query("COMMIT");
    return value;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function probeDatabase(): Promise<boolean> {
  try {
    await Promise.race([pool.query("SELECT 1"), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 2000))]);
    return true;
  } catch {
    return false;
  }
}
