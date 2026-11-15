import pg from "pg";
import { config } from "./config";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20, connectionTimeoutMillis: 5000 });
pool.on("error", (error) => console.error("postgres pool error", error.message));

export type Queryable = Pick<pg.PoolClient, "query">;

export async function rows<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(db: Queryable, sql: string, params: unknown[] = []): Promise<T | undefined> {
  const result = await db.query<T>(sql, params);
  return result.rows[0];
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

const schema = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  handle text NOT NULL UNIQUE,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,
  password_hash text,
  verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  issued_at timestamptz NOT NULL,
  spent boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS pens (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  visibility text NOT NULL CHECK (visibility IN ('private', 'unlisted', 'public')),
  tags text[] NOT NULL DEFAULT '{}',
  head integer NOT NULL DEFAULT 0,
  forked_from_pen text,
  forked_from_version integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pens_owner ON pens (owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS pens_forked_from ON pens (forked_from_pen);
CREATE TABLE IF NOT EXISTS versions (
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  number integer NOT NULL,
  created_at timestamptz NOT NULL,
  sha256 text NOT NULL,
  html bytea NOT NULL,
  css bytea NOT NULL,
  js bytea NOT NULL,
  libraries text[] NOT NULL,
  restored_from integer,
  added integer NOT NULL,
  removed integer NOT NULL,
  changed_chars integer NOT NULL,
  PRIMARY KEY (pen_id, number)
);
CREATE TABLE IF NOT EXISTS likes (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, pen_id)
);
CREATE INDEX IF NOT EXISTS likes_pen ON likes (pen_id);
CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  owner_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS collection_pens (
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (collection_id, pen_id)
);
CREATE TABLE IF NOT EXISTS idempotency_records (
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route text NOT NULL,
  key text NOT NULL,
  pen_id text NOT NULL REFERENCES pens(id) ON DELETE CASCADE,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, route, key)
);
CREATE TABLE IF NOT EXISTS renders (
  id text PRIMARY KEY,
  nonce text NOT NULL,
  pen_id text REFERENCES pens(id) ON DELETE CASCADE,
  html bytea NOT NULL,
  css bytea NOT NULL,
  js bytea NOT NULL,
  libraries text[] NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS renders_created ON renders (created_at);
CREATE TABLE IF NOT EXISTS mail_outbox (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
`;

export async function applySchema(): Promise<void> {
  await transaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(4173001)");
    await client.query(schema);
  });
}
