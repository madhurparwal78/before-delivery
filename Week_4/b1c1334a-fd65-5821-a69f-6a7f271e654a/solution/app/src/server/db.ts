// Postgres: the pool, the schema (created idempotently at start), and the
// transaction helpers every route goes through.
import pg from "pg";
import { config } from "./config.js";

const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 12,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 10_000,
  idle_in_transaction_session_timeout: 15_000,
});
pool.on("error", () => {
  // An idle client lost its connection; the pool replaces it on the next checkout.
});

export type Db = pg.PoolClient;

export class DatabaseUnavailable extends Error {}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY, email text NOT NULL UNIQUE, display_name text NOT NULL, password_hash text NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, account_id text NOT NULL REFERENCES accounts(id), created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS documents (
  id text PRIMARY KEY, name text NOT NULL, owner_id text NOT NULL REFERENCES accounts(id),
  revision integer NOT NULL DEFAULT 0, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS shares (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents(id), email text NOT NULL,
  role text NOT NULL, row_scope text NOT NULL, invite_status text NOT NULL, sending_since timestamptz,
  seq bigserial, UNIQUE (document_id, email));
CREATE TABLE IF NOT EXISTS doc_tables (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents(id), name text NOT NULL, kind text NOT NULL,
  revision integer NOT NULL, owner_column_id text, source_table_id text, group_by jsonb NOT NULL,
  sum_columns jsonb NOT NULL, seq integer NOT NULL, writer text NOT NULL);
CREATE INDEX IF NOT EXISTS doc_tables_document ON doc_tables (document_id);
CREATE TABLE IF NOT EXISTS doc_columns (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents(id), table_id text NOT NULL, name text NOT NULL,
  type text NOT NULL, formula text, target_table_id text, position integer NOT NULL, revision integer NOT NULL,
  deleted boolean NOT NULL, writer text NOT NULL);
CREATE INDEX IF NOT EXISTS doc_columns_document ON doc_columns (document_id);
CREATE TABLE IF NOT EXISTS doc_rows (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents(id), table_id text NOT NULL, seq integer NOT NULL,
  revision integer NOT NULL, deleted boolean NOT NULL, writer text NOT NULL);
CREATE INDEX IF NOT EXISTS doc_rows_document ON doc_rows (document_id);
CREATE TABLE IF NOT EXISTS doc_cells (
  document_id text NOT NULL REFERENCES documents(id), row_id text NOT NULL, column_id text NOT NULL, value jsonb,
  revision integer NOT NULL, writer text NOT NULL, PRIMARY KEY (row_id, column_id));
CREATE INDEX IF NOT EXISTS doc_cells_document ON doc_cells (document_id);
CREATE TABLE IF NOT EXISTS history (
  document_id text NOT NULL REFERENCES documents(id), revision integer NOT NULL, kind text NOT NULL,
  actor_id text NOT NULL, table_id text, PRIMARY KEY (document_id, revision));
CREATE TABLE IF NOT EXISTS undo_entries (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents(id), account_id text NOT NULL,
  stack text NOT NULL, seq bigint NOT NULL, kind text NOT NULL, table_id text, payload jsonb NOT NULL);
CREATE INDEX IF NOT EXISTS undo_entries_owner ON undo_entries (document_id, account_id, stack, seq);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  account_id text NOT NULL, document_id text NOT NULL, key text NOT NULL, request_hash text NOT NULL,
  status integer NOT NULL, body text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, document_id, key));
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY, document_id text NOT NULL REFERENCES documents(id), table_id text NOT NULL,
  file_name text NOT NULL, status text NOT NULL, byte_size bigint, sha256 text, created_by text NOT NULL,
  document_revision integer NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX IF NOT EXISTS exports_owner ON exports (document_id, created_by, created_at);
`;

let ready: Promise<void> | null = null;

// Schema setup and seeding run once per process, under an advisory lock so several
// instances starting together against one database do it exactly once between them.
export function ensureReady(seed: (db: Db) => Promise<void>): Promise<void> {
  if (!ready) {
    ready = (async () => {
      const db = await pool.connect();
      try {
        await db.query("SELECT pg_advisory_lock(7242001)");
        try {
          await db.query(SCHEMA);
          await db.query("BEGIN");
          const { rows } = await db.query("SELECT count(*)::int AS n FROM accounts");
          if (rows[0].n === 0) await seed(db);
          await db.query("COMMIT");
        } catch (error) {
          await db.query("ROLLBACK").catch(() => undefined);
          throw error;
        } finally {
          await db.query("SELECT pg_advisory_unlock(7242001)").catch(() => undefined);
        }
      } finally {
        db.release();
      }
    })().catch((error: unknown) => {
      ready = null;
      throw new DatabaseUnavailable(String(error));
    });
  }
  return ready;
}

async function connect(): Promise<Db> {
  try {
    return await pool.connect();
  } catch (error) {
    throw new DatabaseUnavailable(String(error));
  }
}

// Runs `work` in one transaction; any throw rolls it back.
export async function transaction<T>(
  work: (db: Db) => Promise<T>,
  isolation: "READ COMMITTED" | "REPEATABLE READ" = "READ COMMITTED",
): Promise<T> {
  const db = await connect();
  let broken = false;
  try {
    await db.query(`BEGIN ISOLATION LEVEL ${isolation}`);
    const result = await work(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK").catch(() => {
      broken = true;
    });
    throw error;
  } finally {
    db.release(broken);
  }
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const db = await connect();
  try {
    return (await db.query<T>(text, values)).rows;
  } finally {
    db.release();
  }
}
