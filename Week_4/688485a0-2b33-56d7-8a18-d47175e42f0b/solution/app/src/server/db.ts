import { EventEmitter } from "node:events";
import pg from "pg";
import { config } from "./config.js";

/** PostgreSQL: the pool, the idempotent schema, transactions and the change/role notification channel. */

export type Db = pg.Pool | pg.PoolClient;

const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool:", error.message));

export const db: pg.Pool = pool;

const PG_UNIQUE_VIOLATION = "23505";

/** True when PostgreSQL refused a write on a unique key. */
export const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { code?: string }).code === PG_UNIQUE_VIOLATION;
export const state = { ready: false };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS confirmation_codes (
  email text PRIMARY KEY,
  code text NOT NULL,
  attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, name)
);
CREATE TABLE IF NOT EXISTS members (
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'reader')),
  PRIMARY KEY (project_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL CHECK (role IN ('editor', 'reader')),
  inviter_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_one_pending ON invitations (project_id, email) WHERE state = 'pending';
CREATE TABLE IF NOT EXISTS collections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects ON DELETE CASCADE,
  name text NOT NULL,
  sequence bigint NOT NULL DEFAULT 0,
  validator text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, name)
);
CREATE TABLE IF NOT EXISTS documents (
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  id text COLLATE "C" NOT NULL,
  body text NOT NULL,
  version integer NOT NULL,
  PRIMARY KEY (collection_id, id)
);
CREATE TABLE IF NOT EXISTS indexes (
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  name text COLLATE "C" NOT NULL,
  keys text NOT NULL,
  is_unique boolean NOT NULL,
  PRIMARY KEY (collection_id, name)
);
CREATE TABLE IF NOT EXISTS unique_entries (
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  index_name text NOT NULL,
  key_hash text NOT NULL,
  doc_id text NOT NULL,
  PRIMARY KEY (collection_id, index_name, key_hash)
);
CREATE TABLE IF NOT EXISTS changes (
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  seq bigint NOT NULL,
  op text NOT NULL CHECK (op IN ('insert', 'update', 'delete')),
  doc_id text NOT NULL,
  document text,
  version integer,
  PRIMARY KEY (collection_id, seq)
);
CREATE TABLE IF NOT EXISTS drafts (
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  stages text NOT NULL,
  disabled text NOT NULL,
  PRIMARY KEY (collection_id, user_id)
);
CREATE TABLE IF NOT EXISTS saved_queries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  name text NOT NULL,
  filter text NOT NULL,
  projection text,
  sort text,
  query_limit integer NOT NULL,
  last_run_at timestamptz,
  last_count integer,
  UNIQUE (collection_id, name)
);
CREATE TABLE IF NOT EXISTS file_loads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  position bigserial,
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  file_name text NOT NULL,
  format text NOT NULL,
  state text NOT NULL CHECK (state IN ('uploading', 'stored', 'parsing', 'finished', 'refused')),
  bytes integer NOT NULL,
  inserted integer NOT NULL DEFAULT 0,
  errors text NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS downloads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  collection_id uuid NOT NULL REFERENCES collections ON DELETE CASCADE,
  format text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(727001)");
    await client.query(SCHEMA);
    await client.query("SELECT pg_advisory_unlock(727001)");
  } finally {
    client.release();
  }
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

export function notify(client: Db, payload: string): Promise<unknown> {
  return client.query("SELECT pg_notify('jarful', $1)", [payload]);
}

/** Notifications from every app process: `c:<collection id>` for changes, `r:<project id>:<user id>` for roles. */
export const notices = new EventEmitter();
notices.setMaxListeners(0);

export async function listen(): Promise<void> {
  const connect = async (): Promise<void> => {
    const client = new pg.Client({ connectionString: config.databaseUrl });
    client.on("notification", (message) => notices.emit("notice", message.payload ?? ""));
    let retried = false;
    const retry = (): void => {
      if (retried) return;
      retried = true;
      client.removeAllListeners();
      client.on("error", () => undefined);
      client.end().catch(() => undefined);
      setTimeout(() => void connect(), 1000).unref();
    };
    client.on("error", retry);
    client.on("end", retry);
    try {
      await client.connect();
      await client.query("LISTEN jarful");
      notices.emit("notice", "reconnected");
    } catch {
      retry();
    }
  };
  await connect();
}
