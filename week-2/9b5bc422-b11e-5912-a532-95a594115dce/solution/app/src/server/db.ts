import pg from "pg";
import { config } from "./config.ts";
import { unavailable } from "./http.ts";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  devices_issued integer NOT NULL DEFAULT 0,
  last_seq bigint NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS devices (
  id uuid PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  name text NOT NULL,
  number integer NOT NULL,
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  device_id uuid NOT NULL REFERENCES devices ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS change_log (
  account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  kind text NOT NULL,
  record_id text NOT NULL,
  parent_id text,
  seq bigint NOT NULL,
  fields jsonb NOT NULL,
  PRIMARY KEY (account_id, kind, record_id)
);
CREATE INDEX IF NOT EXISTS change_log_seq ON change_log (account_id, seq);
CREATE INDEX IF NOT EXISTS change_log_parent ON change_log (account_id, parent_id);
CREATE TABLE IF NOT EXISTS deleted_documents (
  account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  document_id text NOT NULL,
  seq bigint NOT NULL,
  PRIMARY KEY (account_id, document_id)
);
CREATE TABLE IF NOT EXISTS share_links (
  token text PRIMARY KEY,
  account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  document_id text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS share_links_document ON share_links (account_id, document_id);
CREATE TABLE IF NOT EXISTS attachments (
  account_id uuid NOT NULL REFERENCES accounts ON DELETE CASCADE,
  id text NOT NULL,
  document_id text,
  name text NOT NULL,
  size integer NOT NULL,
  content_type text NOT NULL,
  digest text NOT NULL,
  awaiting_removal boolean NOT NULL DEFAULT false,
  PRIMARY KEY (account_id, id)
);
`;

const REACH_MS = 1000;

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: REACH_MS,
  max: 10,
});
pool.on("error", () => undefined);

let schemaApplied = false;

/** Answers whether Postgres can be used right now, applying the schema when it has just returned. */
export async function databaseReachable(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    if (!schemaApplied) {
      await pool.query(`BEGIN; SELECT pg_advisory_xact_lock(7291); ${SCHEMA} COMMIT;`);
      schemaApplied = true;
    }
    return true;
  } catch {
    schemaApplied = false;
    return false;
  }
}

export type Queryable = Pick<pg.PoolClient, "query">;

export const db: Queryable = pool;

export async function requireDatabase(): Promise<void> {
  if (!(await databaseReachable())) throw unavailable();
}

export async function transaction<T>(work: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  await requireDatabase();
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
