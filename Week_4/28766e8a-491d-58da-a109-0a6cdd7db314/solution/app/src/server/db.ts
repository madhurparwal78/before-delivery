// Postgres: the source of truth. The schema is applied idempotently on every serve under an
// advisory lock, so two instances starting together both succeed (brief: Deployment).
import pg from "pg";
import { ApiError } from "../shared/errors";
import { config } from "./config";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });

// An idle client dropped by the server is replaced on the next query; it must not stop the app.
pool.on("error", (error) => console.error("postgres idle client error:", error.message));

export type Queryable = pg.Pool | pg.PoolClient;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS diagrams (
  id text PRIMARY KEY,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES users(id),
  doc jsonb NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now(),
  version_due_at timestamptz,
  version_due_author text,
  next_version integer NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS members (
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  PRIMARY KEY (diagram_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  status text NOT NULL,
  inviter_id text NOT NULL REFERENCES users(id),
  sent_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS operations (
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  user_id text NOT NULL,
  op_id text NOT NULL,
  body jsonb NOT NULL,
  response json NOT NULL,
  changes jsonb NOT NULL,
  touched jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (diagram_id, seq),
  UNIQUE (diagram_id, user_id, op_id)
);
CREATE INDEX IF NOT EXISTS operations_touched ON operations USING gin (touched);
CREATE UNIQUE INDEX IF NOT EXISTS invites_open ON invites (diagram_id, email) WHERE status IN ('emailed', 'email_not_sent');
CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  shape_id text NOT NULL,
  page_id text NOT NULL,
  author_id text NOT NULL REFERENCES users(id),
  text text NOT NULL,
  resolved boolean NOT NULL DEFAULT false,
  anchored boolean NOT NULL DEFAULT true,
  parent_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS versions (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  number integer NOT NULL,
  name text,
  author_id text NOT NULL REFERENCES users(id),
  seq integer NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  diagram_id text NOT NULL REFERENCES diagrams(id) ON DELETE CASCADE,
  page_id text NOT NULL,
  format text NOT NULL,
  scale integer NOT NULL,
  background text NOT NULL,
  status text NOT NULL,
  requested_by text NOT NULL REFERENCES users(id),
  seq integer NOT NULL,
  snapshot jsonb NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
`;

export async function migrate(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(4173001)");
    await client.query(SCHEMA);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/** The single row a query must return. */
export function one<T>(rows: T[]): T {
  const row = rows[0];
  if (row === undefined) throw new ApiError("internal");
  return row;
}

/** True for a unique-constraint violation. */
export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "23505";
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
