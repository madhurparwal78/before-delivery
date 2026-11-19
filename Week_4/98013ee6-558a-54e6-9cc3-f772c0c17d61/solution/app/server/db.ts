import pg from "pg";
import { config } from "./config.js";

pg.types.setTypeParser(20, (value: string) => Number(value));

export type Db = pg.Pool | pg.PoolClient;

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12 });
pool.on("error", (error) => console.error("postgres pool error", error.message));

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

export async function rows<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await db.query<T>(sql, params)).rows[0] ?? null;
}

/** A statement that always yields a row (an INSERT ... RETURNING, an aggregate). */
export async function exactlyOne<T extends pg.QueryResultRow>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = (await db.query<T>(sql, params)).rows[0];
  if (!row) throw new Error("the statement returned no row");
  return row;
}

/** Postgres reports a unique-index conflict (a name or handle taken in a race) with this code. */
export const isUniqueViolation = (error: unknown): boolean => typeof error === "object" && error !== null && "code" in error && error.code === "23505";

export async function waitForDatabase(): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  console.error("postgres is unreachable; giving up");
  process.exit(1);
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS clock (id smallint PRIMARY KEY, offset_ms bigint NOT NULL, started_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS users (
  id bigserial PRIMARY KEY, email text NOT NULL, password_hash text NOT NULL, name text NOT NULL,
  handle text NOT NULL, created_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_handle_key ON users (handle);
CREATE TABLE IF NOT EXISTS signups (
  email text PRIMARY KEY, password_hash text NOT NULL, name text NOT NULL, handle text NOT NULL,
  code_hash text NOT NULL, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, created_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS images (
  id uuid PRIMARY KEY, sha256 text NOT NULL, width int NOT NULL, height int NOT NULL, format text NOT NULL,
  variants int[] NOT NULL, purged boolean NOT NULL DEFAULT false);
CREATE TABLE IF NOT EXISTS boards (
  id bigserial PRIMARY KEY, owner_id bigint NOT NULL REFERENCES users(id), name text NOT NULL,
  visibility text NOT NULL, cover_pin_id bigint, seq int NOT NULL DEFAULT 0, last_saved_at timestamptz,
  created_at timestamptz NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS boards_owner_name_key ON boards (owner_id, lower(name));
CREATE TABLE IF NOT EXISTS board_members (
  board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE, user_id bigint NOT NULL REFERENCES users(id),
  role text NOT NULL, PRIMARY KEY (board_id, user_id));
CREATE TABLE IF NOT EXISTS sections (
  id bigserial PRIMARY KEY, board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name text NOT NULL, position int NOT NULL);
CREATE UNIQUE INDEX IF NOT EXISTS sections_board_name_key ON sections (board_id, lower(name));
CREATE TABLE IF NOT EXISTS pins (
  id bigserial PRIMARY KEY, owner_id bigint NOT NULL REFERENCES users(id),
  board_id bigint REFERENCES boards(id) ON DELETE SET NULL, section_id bigint REFERENCES sections(id) ON DELETE SET NULL,
  position int, image_id uuid NOT NULL REFERENCES images(id), title text NOT NULL, description text NOT NULL DEFAULT '',
  alt text NOT NULL, source text, tags text[] NOT NULL DEFAULT '{}', search_words text[] NOT NULL DEFAULT '{}',
  version int NOT NULL DEFAULT 1, saved_from bigint REFERENCES pins(id), state text NOT NULL DEFAULT 'live',
  delete_op_id bigint, vanished_viewers bigint[], created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS pins_container ON pins (board_id, section_id, position);
CREATE INDEX IF NOT EXISTS pins_saved_from ON pins (saved_from);
CREATE INDEX IF NOT EXISTS pins_owner ON pins (owner_id, created_at);
CREATE INDEX IF NOT EXISTS pins_image ON pins (image_id);
CREATE TABLE IF NOT EXISTS follows (
  follower_id bigint NOT NULL REFERENCES users(id), user_id bigint NOT NULL REFERENCES users(id),
  PRIMARY KEY (follower_id, user_id));
CREATE TABLE IF NOT EXISTS board_follows (
  follower_id bigint NOT NULL REFERENCES users(id), board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  PRIMARY KEY (follower_id, board_id));
CREATE TABLE IF NOT EXISTS comments (
  id bigserial PRIMARY KEY, pin_id bigint NOT NULL REFERENCES pins(id), author_id bigint NOT NULL REFERENCES users(id),
  parent_id bigint REFERENCES comments(id), text text NOT NULL, deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS comments_pin ON comments (pin_id);
CREATE TABLE IF NOT EXISTS reactions (
  pin_id bigint NOT NULL REFERENCES pins(id), user_id bigint NOT NULL REFERENCES users(id),
  type text NOT NULL, created_at timestamptz NOT NULL, PRIMARY KEY (pin_id, user_id));
CREATE TABLE IF NOT EXISTS operations (
  id bigserial PRIMARY KEY, kind text NOT NULL, actor_id bigint NOT NULL REFERENCES users(id),
  board_id bigint, section_id bigint, count int NOT NULL, created_at timestamptz NOT NULL,
  deadline timestamptz NOT NULL, status text NOT NULL DEFAULT 'open');
CREATE TABLE IF NOT EXISTS operation_items (
  op_id bigint NOT NULL REFERENCES operations(id) ON DELETE CASCADE, pin_id bigint NOT NULL, idx int NOT NULL,
  prior_board_id bigint, prior_section_id bigint, new_pin_id bigint, PRIMARY KEY (op_id, pin_id));
CREATE TABLE IF NOT EXISTS operation_boards (
  op_id bigint NOT NULL REFERENCES operations(id) ON DELETE CASCADE, board_id bigint NOT NULL,
  prior_last_saved_at timestamptz, prior_order jsonb NOT NULL, PRIMARY KEY (op_id, board_id));
CREATE TABLE IF NOT EXISTS invites (
  id bigserial PRIMARY KEY, board_id bigint NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  inviter_id bigint NOT NULL REFERENCES users(id), email text NOT NULL, role text NOT NULL,
  token text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'pending', created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL);
CREATE TABLE IF NOT EXISTS live_events (id bigserial PRIMARY KEY, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS presence (
  conn_id text PRIMARY KEY, instance text NOT NULL, board_id bigint NOT NULL, user_id bigint NOT NULL,
  since timestamptz NOT NULL, seen_at timestamptz NOT NULL);
CREATE INDEX IF NOT EXISTS presence_board ON presence (board_id);
`;

const SCHEMA_LOCK = 7203001;

export async function applySchema(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}
