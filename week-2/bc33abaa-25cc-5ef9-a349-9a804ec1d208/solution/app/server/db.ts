// PostgreSQL: connection pool, transactions and the schema, applied idempotently on every serve.
import pg from "pg";
import { config } from "./config.js";

// bigint columns hold cents and byte counts, all far inside the safe integer range.
pg.types.setTypeParser(pg.types.builtins.INT8, Number);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, connectionTimeoutMillis: 10_000 });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Row = pg.QueryResultRow;

export async function rows<T extends Row>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends Row>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** Runs work while holding a session-level advisory lock, so callers on every serve instance queue in arrival order. */
export async function withAdvisoryLock<T>(name: string, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext($1))", [name]);
    try {
      return await work();
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [name]);
    }
  } finally {
    client.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY, name text NOT NULL, time_zone text NOT NULL,
  review_links_enabled boolean NOT NULL DEFAULT true, signing_secret text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, email text NOT NULL,
  password_hash text NOT NULL, role text NOT NULL, joined_at timestamptz NOT NULL, removed_at timestamptz);
CREATE UNIQUE INDEX IF NOT EXISTS members_active_email ON members (lower(email)) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS members_workspace ON members (workspace_id);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, member_id text NOT NULL REFERENCES members(id),
  created_at timestamptz NOT NULL, ended_at timestamptz);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), email text NOT NULL, role text NOT NULL,
  token_hash text NOT NULL UNIQUE, invited_by_kind text NOT NULL, invited_by_id text NOT NULL, invited_by_name text NOT NULL,
  created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL, accepted_at timestamptz, revoked_at timestamptz);
CREATE TABLE IF NOT EXISTS agent_tokens (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL, scope text NOT NULL,
  secret_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  issued_by_id text NOT NULL, issued_by_name text NOT NULL, created_at timestamptz NOT NULL,
  warn_at timestamptz NOT NULL, warned_at timestamptz);
CREATE TABLE IF NOT EXISTS subscriptions (
  workspace_id text PRIMARY KEY REFERENCES workspaces(id), state text NOT NULL, plan text NOT NULL, period text NOT NULL,
  extra_seats integer NOT NULL DEFAULT 0, trial_ends_at timestamptz, suspended_by text,
  failed_at timestamptz, dunning_day3_at timestamptz, dunning_day3_sent boolean NOT NULL DEFAULT false, grace_ends_at timestamptz,
  pending_change jsonb, kb_account_id text, card_last4 text);
CREATE TABLE IF NOT EXISTS scenes (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), name text NOT NULL,
  base_graph jsonb NOT NULL, graph jsonb NOT NULL, latest_seq integer NOT NULL DEFAULT 0, embed_id text UNIQUE,
  created_at timestamptz NOT NULL, updated_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS scenes_workspace ON scenes (workspace_id);
CREATE TABLE IF NOT EXISTS ops (
  scene_id text NOT NULL REFERENCES scenes(id), seq integer NOT NULL, batch_id text NOT NULL, type text NOT NULL,
  payload jsonb NOT NULL, inverse jsonb NOT NULL, author_kind text NOT NULL, author_id text NOT NULL, author_name text NOT NULL,
  created_at timestamptz NOT NULL, undo_of text, redo_of text, restore_to integer, PRIMARY KEY (scene_id, seq));
CREATE INDEX IF NOT EXISTS ops_author ON ops (scene_id, author_kind, author_id, seq);
CREATE INDEX IF NOT EXISTS ops_batch ON ops (batch_id);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY, scene_id text NOT NULL REFERENCES scenes(id), workspace_id text NOT NULL, number integer NOT NULL,
  label text NOT NULL, state text NOT NULL, seq integer NOT NULL, created_by_kind text NOT NULL, created_by_id text NOT NULL,
  created_by_name text NOT NULL, publish_at timestamptz, published_at timestamptz, scheduled_by text,
  has_thumbnail boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL, UNIQUE (scene_id, number));
CREATE TABLE IF NOT EXISTS approvals (
  version_id text NOT NULL REFERENCES versions(id), member_id text NOT NULL, member_name text NOT NULL,
  at timestamptz NOT NULL, PRIMARY KEY (version_id, member_id));
CREATE TABLE IF NOT EXISTS review_links (
  id text PRIMARY KEY, workspace_id text NOT NULL, version_id text NOT NULL REFERENCES versions(id),
  token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
  created_by_kind text NOT NULL, created_by_id text NOT NULL, created_by_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS assets (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id), kind text NOT NULL, name text NOT NULL,
  bytes bigint NOT NULL, content_type text NOT NULL, uploaded_by_kind text NOT NULL, uploaded_by_id text NOT NULL,
  uploaded_by_name text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY, workspace_id text NOT NULL, version_id text NOT NULL REFERENCES versions(id),
  bytes bigint NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS audit_entries (
  id bigserial PRIMARY KEY, workspace_id text NOT NULL, at timestamptz NOT NULL, actor_kind text NOT NULL,
  actor_id text NOT NULL, actor_name text NOT NULL, action text NOT NULL, target_type text NOT NULL, target_id text NOT NULL);
CREATE INDEX IF NOT EXISTS audit_workspace ON audit_entries (workspace_id, at DESC, id DESC);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  workspace_id text NOT NULL, key text NOT NULL, fingerprint text NOT NULL, status integer, body text,
  created_at timestamptz NOT NULL, PRIMARY KEY (workspace_id, key));
CREATE TABLE IF NOT EXISTS webhook_events (
  workspace_id text NOT NULL, event_id text NOT NULL, body_hash text NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, event_id));
CREATE TABLE IF NOT EXISTS payments (
  id text PRIMARY KEY, workspace_id text NOT NULL, invoice_id text NOT NULL, invoice_number text NOT NULL, amount_cents bigint NOT NULL,
  refunded_cents bigint NOT NULL DEFAULT 0, charged_back boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS invoice_documents (
  invoice_id text PRIMARY KEY, workspace_id text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY, recipients jsonb NOT NULL, from_name text NOT NULL, subject text NOT NULL, body text NOT NULL,
  created_at timestamptz NOT NULL, sent_at timestamptz);
CREATE INDEX IF NOT EXISTS mail_outbox_unsent ON mail_outbox (id) WHERE sent_at IS NULL;
`;

export async function applySchema(): Promise<void> {
  await withAdvisoryLock("orrery:schema", async () => {
    await pool.query(SCHEMA);
  });
}
