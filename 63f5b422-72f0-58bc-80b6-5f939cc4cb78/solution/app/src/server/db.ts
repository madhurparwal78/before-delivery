import { randomBytes } from "node:crypto";
import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", (error) => console.error("postgres pool error", error.message));

export type Db = pg.Pool | pg.PoolClient;

const ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";

/** A persistent id: the prefix, an underscore and 12 lowercase letters or digits. */
export function newId(prefix: string): string {
  const bytes = randomBytes(12);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % 36];
  return `${prefix}_${out}`;
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | undefined> {
  return (await db.query(sql, params)).rows[0] as T | undefined;
}

export async function all<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query(sql, params)).rows as T[];
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY, name text NOT NULL, email text NOT NULL UNIQUE, password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY, slug text NOT NULL UNIQUE, seq integer NOT NULL DEFAULT 0, doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS workspaces_pages ON workspaces USING gin ((doc->'pages') jsonb_path_ops);
CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id text NOT NULL REFERENCES users(id),
  role text NOT NULL, joined_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, user_id));
CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, email text NOT NULL,
  role text NOT NULL, token_hash text NOT NULL UNIQUE, status text NOT NULL, invited_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE UNIQUE INDEX IF NOT EXISTS invitations_pending ON invitations (workspace_id, email) WHERE status = 'pending';
CREATE TABLE IF NOT EXISTS operations (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, seq integer NOT NULL, op_id text,
  author_id text NOT NULL, author_name text NOT NULL, kind text NOT NULL, fields jsonb NOT NULL, created jsonb,
  touch_keys text[] NOT NULL, touch_nodes text[] NOT NULL, structural text[] NOT NULL,
  pages text[] NOT NULL, at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, seq));
CREATE UNIQUE INDEX IF NOT EXISTS operations_replay ON operations (workspace_id, author_id, op_id) WHERE op_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS undo_stack (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, user_id text NOT NULL, stack text NOT NULL,
  seq integer NOT NULL, inverse jsonb NOT NULL, PRIMARY KEY (workspace_id, user_id, stack, seq));
CREATE TABLE IF NOT EXISTS tombstones (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, node_id text NOT NULL, node_name text NOT NULL,
  deleted_by text NOT NULL, PRIMARY KEY (workspace_id, node_id));
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, position integer NOT NULL,
  name text NOT NULL, author_id text NOT NULL, author_name text NOT NULL, seq integer NOT NULL, document jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, page_id text NOT NULL,
  node_id text NOT NULL, node_name text NOT NULL, author_id text NOT NULL, body text NOT NULL, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS replies (
  id text PRIMARY KEY, comment_id text NOT NULL REFERENCES comments(id) ON DELETE CASCADE, author_id text NOT NULL,
  body text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS images (
  id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, file_name text NOT NULL,
  mime text NOT NULL, width integer NOT NULL, height integer NOT NULL, status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS publishes (
  page_id text PRIMARY KEY, workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  publish_id text NOT NULL, published_seq integer NOT NULL, state text NOT NULL, images text[] NOT NULL DEFAULT '{}',
  updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS idempotency_keys (
  key text PRIMARY KEY, page_id text NOT NULL, status text NOT NULL, response jsonb,
  created_at timestamptz NOT NULL DEFAULT now());
`;

const SCHEMA_LOCK = 4_173_001;

/** Connect (retrying for up to 60 s) and apply the schema idempotently; exits non-zero if Postgres never answers. */
export async function boot(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
      } finally {
        client.release();
      }
      return;
    } catch (error) {
      if (Date.now() > deadline) {
        console.error("Postgres is unreachable:", (error as Error).message);
        process.exit(1);
      }
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
