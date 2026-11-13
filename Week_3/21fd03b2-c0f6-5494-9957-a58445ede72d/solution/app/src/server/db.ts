import pg from "pg";
import { config } from "./config";

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  application_name: "rampwright",
  idle_in_transaction_session_timeout: 15000,
  statement_timeout: 30000,
});
pool.on("error", () => undefined);

export type Db = Pick<pg.PoolClient, "query">;

export async function tx<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
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

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, email text NOT NULL, email_key text NOT NULL UNIQUE, display_name text NOT NULL,
  password_hash text NOT NULL, last_workspace_id text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS memberships (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','editor','viewer')), joined_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, user_id));
CREATE INDEX IF NOT EXISTS memberships_user ON memberships (user_id, joined_at);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, email text NOT NULL, email_key text NOT NULL,
  role text NOT NULL, token text NOT NULL UNIQUE, status text NOT NULL, reason text, inviter_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS invites_one_pending ON invites (workspace_id, email_key) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, workspace_id text NOT NULL,
  name text NOT NULL, status text NOT NULL, revision integer NOT NULL, restore_revision integer NOT NULL DEFAULT 0,
  state_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS scene_revisions (
  scene_id text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE, revision integer NOT NULL, document text NOT NULL,
  ops jsonb NOT NULL, change_id text, request_hash text, base_revision integer, keys text[] NOT NULL DEFAULT '{}',
  removed text[] NOT NULL DEFAULT '{}', state_hash text NOT NULL, kind text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scene_id, revision));
CREATE UNIQUE INDEX IF NOT EXISTS scene_revisions_change ON scene_revisions (scene_id, change_id) WHERE change_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS checkpoints (
  id text PRIMARY KEY, scene_id text NOT NULL REFERENCES scenes(id) ON DELETE CASCADE, label text NOT NULL, label_key text NOT NULL,
  revision integer NOT NULL, state_hash text NOT NULL, document_sha256 text NOT NULL, created_at timestamptz NOT NULL,
  UNIQUE (scene_id, label_key));
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, name text NOT NULL, kind text NOT NULL,
  bytes integer NOT NULL, sha256 text NOT NULL, unit text, scale_to_metres double precision, extent_metres double precision,
  created_at timestamptz NOT NULL, UNIQUE (project_id, sha256));
CREATE TABLE IF NOT EXISTS activity (
  seq bigserial PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, actor_id text NOT NULL REFERENCES users(id),
  action text NOT NULL, target_name text NOT NULL, at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS activity_page ON activity (workspace_id, at DESC, seq DESC);
CREATE TABLE IF NOT EXISTS share_links (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE, token text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS labs (
  scene_id text PRIMARY KEY REFERENCES scenes(id) ON DELETE CASCADE, token text NOT NULL UNIQUE, bundle_hash text NOT NULL,
  published_at timestamptz NOT NULL, checkpoint_id text NOT NULL, exposed jsonb NOT NULL);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY, kind text NOT NULL, recipient text NOT NULL, subject text NOT NULL, body text NOT NULL, ref_id text,
  state text NOT NULL DEFAULT 'queued', claimed_at timestamptz, attempts integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(), sent_at timestamptz);
CREATE INDEX IF NOT EXISTS mail_outbox_pending ON mail_outbox (state, id);
`;

const SCHEMA_LOCK = 7351001;

/** Applies the schema idempotently; the advisory lock makes parallel instances take turns. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}

async function withAdvisoryLock<T>(key: number, work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  return tx(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock($1)", [key]);
    return work(client);
  });
}
