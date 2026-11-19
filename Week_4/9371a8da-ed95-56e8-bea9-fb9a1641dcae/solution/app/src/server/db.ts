// PostgreSQL: the pool, transactions, the schema and the boot retry.
import pg from "pg";
import { config } from "./config.ts";
import { seed } from "./seed.ts";

export type Db = pg.PoolClient | pg.Pool;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres idle client error:", error.message));

let ready = false;
let announceReady: () => void = () => undefined;
const readySignal = new Promise<void>((resolve) => {
  announceReady = resolve;
});

export function databaseReady(): boolean {
  return ready;
}

/** Requests that arrive while the schema is being applied wait for it, up to a few seconds. */
export async function awaitDatabase(): Promise<boolean> {
  if (ready) return true;
  await Promise.race([readySignal, new Promise((resolve) => setTimeout(resolve, 8000))]);
  return ready;
}

export async function query<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R[]> {
  return (await db.query<R>(sql, params)).rows;
}

export async function one<R extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<R | undefined> {
  return (await query<R>(db, sql, params))[0];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

/** Serialises work of one kind on one project across every app instance. */
export async function turn(client: pg.PoolClient, kind: string, projectId: string): Promise<void> {
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${kind}:${projectId}`]);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (id text PRIMARY KEY, name text NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL, email_key text NOT NULL UNIQUE, display_name text NOT NULL,
  handle text NOT NULL UNIQUE, password_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id text NOT NULL REFERENCES workspaces, user_id text NOT NULL REFERENCES users, role text NOT NULL,
  PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces, title text NOT NULL, template text NOT NULL,
  revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memberships (
  project_id text NOT NULL REFERENCES projects, user_id text NOT NULL REFERENCES users, role text NOT NULL,
  PRIMARY KEY (project_id, user_id));
CREATE TABLE IF NOT EXISTS files (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, kind text NOT NULL,
  content_type text, size bigint, sha256 text);
CREATE TABLE IF NOT EXISTS text_revisions (
  file_id text NOT NULL REFERENCES files, revision integer NOT NULL, content text NOT NULL,
  PRIMARY KEY (file_id, revision));
CREATE TABLE IF NOT EXISTS tree (
  project_id text NOT NULL, project_revision integer NOT NULL, file_id text NOT NULL REFERENCES files,
  path text NOT NULL, text_revision integer,
  PRIMARY KEY (project_id, project_revision, file_id),
  UNIQUE (project_id, project_revision, path) DEFERRABLE INITIALLY DEFERRED);
CREATE TABLE IF NOT EXISTS ledger (
  project_id text NOT NULL REFERENCES projects, project_revision integer NOT NULL, kind text NOT NULL,
  summary text NOT NULL, actor_id text NOT NULL, actor_name text NOT NULL, actor_handle text NOT NULL,
  at timestamptz NOT NULL, PRIMARY KEY (project_id, project_revision));
CREATE TABLE IF NOT EXISTS labels (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, name text NOT NULL, name_key text NOT NULL,
  project_revision integer NOT NULL, created_at timestamptz NOT NULL, creator_id text NOT NULL,
  creator_name text NOT NULL, creator_handle text NOT NULL, UNIQUE (project_id, name_key));
CREATE TABLE IF NOT EXISTS suggestions (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, file_id text NOT NULL REFERENCES files,
  from_pos integer, to_pos integer, deleted text NOT NULL, inserted text NOT NULL, status text NOT NULL,
  author_id text NOT NULL REFERENCES users, created_at timestamptz NOT NULL, resolved_by text REFERENCES users,
  resolved_at timestamptz, orphaned_at timestamptz, seq bigserial);
CREATE TABLE IF NOT EXISTS threads (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, file_id text NOT NULL REFERENCES files,
  from_pos integer, to_pos integer, quote text NOT NULL, status text NOT NULL, orphaned boolean NOT NULL,
  created_at timestamptz NOT NULL, resolved_by text REFERENCES users, resolved_at timestamptz, orphaned_at timestamptz, seq bigserial);
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY, thread_id text NOT NULL REFERENCES threads, author_id text NOT NULL REFERENCES users,
  body text NOT NULL, created_at timestamptz NOT NULL, seq bigserial);
CREATE TABLE IF NOT EXISTS citation_reports (
  project_id text NOT NULL, project_revision integer NOT NULL, check_id text NOT NULL, report jsonb NOT NULL,
  PRIMARY KEY (project_id, project_revision));
CREATE TABLE IF NOT EXISTS save_answers (
  user_id text NOT NULL, file_id text NOT NULL, key text NOT NULL, fingerprint text NOT NULL,
  status integer NOT NULL, body text NOT NULL, stored_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, file_id, key));
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, email text NOT NULL, email_key text NOT NULL,
  role text NOT NULL, token_hash text NOT NULL UNIQUE, status text NOT NULL, sent_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL, inviter_id text NOT NULL REFERENCES users);
CREATE TABLE IF NOT EXISTS share_links (
  project_id text PRIMARY KEY REFERENCES projects, token text NOT NULL UNIQUE, created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, project_revision integer NOT NULL,
  size bigint NOT NULL, sha256 text NOT NULL, UNIQUE (project_id, project_revision));
CREATE TABLE IF NOT EXISTS mention_emails (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects, thread_id text NOT NULL REFERENCES threads,
  recipient_id text NOT NULL REFERENCES users, subject text NOT NULL, comment_body text NOT NULL, quote text NOT NULL,
  state text NOT NULL, created_at timestamptz NOT NULL, due_at timestamptz NOT NULL, posted_by text NOT NULL,
  first_attempted boolean NOT NULL DEFAULT false, claimed_by text, sent_at timestamptz);
`;

const MIGRATION_LOCK = 4_173_017;

async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK]);
    try {
      await client.query(SCHEMA);
      const seeded = await client.query("SELECT 1 FROM workspaces LIMIT 1");
      if (seeded.rowCount === 0) {
        await client.query("BEGIN");
        await seed(client);
        await client.query("COMMIT");
      }
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK]);
    }
  } finally {
    client.release();
  }
}

/** Apply schema and seed, retrying every few seconds until PostgreSQL answers. */
export async function connectWhenReachable(): Promise<void> {
  for (;;) {
    try {
      await migrate();
      await Promise.all(Array.from({ length: 4 }, () => pool.query("SELECT 1")));
      ready = true;
      announceReady();
      return;
    } catch (error) {
      console.error("postgres not ready:", error instanceof Error ? error.message : error);
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
}
