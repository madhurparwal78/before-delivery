// PostgreSQL: the system of record. Schema and seed are applied on every serve, idempotently.
import pg from "pg";

export type Db = pg.Pool;
export type Tx = pg.PoolClient;
export type Queryable = pg.Pool | pg.PoolClient;

const SCHEMA_LOCK = 724_031_918;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS stations (
  id uuid PRIMARY KEY,
  name text NOT NULL UNIQUE,
  time_zone text NOT NULL
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES stations(id),
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  password_hash text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invites (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS workbooks (
  id uuid PRIMARY KEY,
  station_id uuid NOT NULL REFERENCES stations(id),
  name text NOT NULL,
  state text NOT NULL,
  closes_at_local text,
  closes_at_utc timestamptz,
  genesis jsonb NOT NULL,
  head_seq integer NOT NULL DEFAULT 0,
  sheet_count integer NOT NULL,
  original_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS workbooks_station ON workbooks (station_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS workbooks_cutoff ON workbooks (closes_at_utc) WHERE state = 'in_season';
CREATE TABLE IF NOT EXISTS ops (
  workbook_id uuid NOT NULL REFERENCES workbooks(id),
  seq integer NOT NULL,
  type text NOT NULL,
  body jsonb NOT NULL,
  author_id uuid,
  author_name text,
  received_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workbook_id, seq)
);
CREATE TABLE IF NOT EXISTS request_keys (
  scope text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (scope, key)
);
CREATE TABLE IF NOT EXISTS conflicts (
  id uuid PRIMARY KEY,
  workbook_id uuid NOT NULL REFERENCES workbooks(id),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  kind text NOT NULL,
  sheet_id uuid NOT NULL,
  sheet_name text NOT NULL,
  cell text NOT NULL,
  my_input text NOT NULL,
  current_input text NOT NULL,
  current_author_id uuid,
  current_author_name text,
  reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  resolved_at timestamptz,
  choice text
);
CREATE INDEX IF NOT EXISTS conflicts_open ON conflicts (workbook_id, member_id) WHERE resolved_at IS NULL;
CREATE TABLE IF NOT EXISTS versions (
  id uuid PRIMARY KEY,
  workbook_id uuid NOT NULL REFERENCES workbooks(id),
  number integer NOT NULL,
  label text NOT NULL,
  kind text NOT NULL,
  seq integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_by_id uuid NOT NULL,
  created_by_name text NOT NULL,
  UNIQUE (workbook_id, number)
);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  workbook_id uuid NOT NULL REFERENCES workbooks(id),
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  format text NOT NULL,
  sheet_id uuid,
  file_name text NOT NULL,
  status text NOT NULL,
  head_seq integer NOT NULL,
  origin text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  ready_at timestamptz
);
CREATE INDEX IF NOT EXISTS exports_waiting ON exports (created_at) WHERE status <> 'ready';
CREATE TABLE IF NOT EXISTS share_links (
  id uuid PRIMARY KEY,
  workbook_id uuid NOT NULL REFERENCES workbooks(id),
  token text NOT NULL UNIQUE,
  lifetime_seconds integer NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS mail_queue (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS mail_unsent ON mail_queue (id) WHERE sent_at IS NULL;
`;

export function createDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 20 });
  pool.on("error", () => {
    // An idle client lost its connection; the pool replaces it on the next checkout.
  });
  return pool;
}

export async function tx<T>(db: Db, work: (t: Tx) => Promise<T>): Promise<T> {
  const client = await db.connect();
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

/** Blocks until PostgreSQL answers, retrying every 2 seconds. */
export async function waitForDatabase(db: Db): Promise<void> {
  for (;;) {
    try {
      await db.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/** Applies the schema and, through `seed`, the seed data, under one advisory lock shared by every instance. */
export async function prepareDatabase(db: Db, seed: (t: Tx) => Promise<void>): Promise<void> {
  await tx(db, async (t) => {
    await t.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await t.query(SCHEMA);
    await seed(t);
  });
}
