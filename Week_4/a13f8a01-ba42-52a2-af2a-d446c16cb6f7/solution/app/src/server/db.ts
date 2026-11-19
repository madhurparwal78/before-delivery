import pg from "pg";
import { config } from "./config.js";

export type Tx = pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

pool.on("error", () => undefined);

export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const tx = await pool.connect();
  try {
    await tx.query("BEGIN");
    const result = await work(tx);
    await tx.query("COMMIT");
    return result;
  } catch (error) {
    await tx.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    tx.release();
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  email text NOT NULL,
  password_hash text,
  verified boolean NOT NULL DEFAULT false,
  verification_sent boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verify_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  issued_at timestamptz NOT NULL DEFAULT now(),
  used boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS pens (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  title text NOT NULL,
  visibility text NOT NULL,
  starter integer UNIQUE,
  fork_of_pen text,
  fork_of_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pens_owner ON pens (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS pens_fork_of ON pens (fork_of_pen);
CREATE TABLE IF NOT EXISTS pen_tags (
  pen_id text NOT NULL REFERENCES pens ON DELETE CASCADE,
  position integer NOT NULL,
  tag text NOT NULL,
  PRIMARY KEY (pen_id, tag)
);
CREATE INDEX IF NOT EXISTS pen_tags_tag ON pen_tags (tag);
CREATE TABLE IF NOT EXISTS versions (
  pen_id text NOT NULL REFERENCES pens ON DELETE CASCADE,
  number integer NOT NULL,
  created_at timestamptz NOT NULL,
  sha256 text NOT NULL,
  restored_from integer,
  added integer NOT NULL,
  removed integer NOT NULL,
  changed_chars integer NOT NULL,
  PRIMARY KEY (pen_id, number)
);
CREATE TABLE IF NOT EXISTS pen_likes (
  pen_id text NOT NULL REFERENCES pens ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (pen_id, user_id)
);
CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_pens (
  collection_id text NOT NULL REFERENCES collections ON DELETE CASCADE,
  pen_id text NOT NULL REFERENCES pens ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (collection_id, pen_id)
);
CREATE TABLE IF NOT EXISTS renders (
  id text PRIMARY KEY,
  nonce text NOT NULL,
  html text NOT NULL,
  css text NOT NULL,
  js text NOT NULL,
  libraries text[] NOT NULL,
  pen_id text REFERENCES pens ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id text NOT NULL REFERENCES users ON DELETE CASCADE,
  route text NOT NULL,
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  response text,
  pen_id text REFERENCES pens ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, key)
);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY,
  to_address text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
`;

const SCHEMA_LOCK = 724_001;

export async function applySchema(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
    await tx.query(SCHEMA);
  });
}

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (attempt >= 120) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

export async function databaseAnswers(): Promise<boolean> {
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}
