import pg from "pg";
import { config } from "./config";

const SCHEMA = `
CREATE SEQUENCE IF NOT EXISTS text_sequence;

CREATE TABLE IF NOT EXISTS typists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  settings jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  typist_id uuid NOT NULL REFERENCES typists(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sign_in_failures (
  id bigserial PRIMARY KEY,
  email_key text NOT NULL,
  failed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sign_in_failures_email ON sign_in_failures (email_key, failed_at);

CREATE TABLE IF NOT EXISTS link_tokens (
  token_hash text PRIMARY KEY,
  typist_id uuid NOT NULL REFERENCES typists(id) ON DELETE CASCADE,
  purpose text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS pending_mail (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);

CREATE TABLE IF NOT EXISTS tickets (
  id uuid PRIMARY KEY,
  typist_id uuid REFERENCES typists(id) ON DELETE CASCADE,
  sequence bigint NOT NULL,
  seed bigint,
  mode text NOT NULL,
  length text,
  punctuation boolean NOT NULL,
  numbers boolean NOT NULL,
  words jsonb NOT NULL,
  quote_id text,
  issued_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS runs (
  id uuid PRIMARY KEY,
  typist_id uuid NOT NULL REFERENCES typists(id) ON DELETE CASCADE,
  ticket_id uuid UNIQUE REFERENCES tickets(id) ON DELETE CASCADE,
  mode text NOT NULL,
  length text,
  punctuation boolean NOT NULL,
  numbers boolean NOT NULL,
  quote_id text,
  words jsonb NOT NULL,
  log json NOT NULL,
  duration double precision,
  speed double precision,
  raw double precision,
  accuracy double precision,
  consistency double precision,
  characters jsonb,
  verdict text NOT NULL,
  reason text,
  finished_at timestamptz NOT NULL DEFAULT now(),
  proof_key text,
  request_body bytea,
  response_status integer,
  response_body text
);
CREATE INDEX IF NOT EXISTS runs_typist_finished ON runs (typist_id, finished_at DESC);
CREATE INDEX IF NOT EXISTS runs_board ON runs (length, finished_at) WHERE verdict = 'counted' AND mode = 'time';
`;

const SCHEMA_LOCK = 4_173_001;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export type Queryable = Pick<pg.PoolClient, "query">;

/** Applies the schema idempotently; the advisory lock lets several app processes start against one database. */
export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    try {
      await client.query(SCHEMA);
    } finally {
      await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]);
    }
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

