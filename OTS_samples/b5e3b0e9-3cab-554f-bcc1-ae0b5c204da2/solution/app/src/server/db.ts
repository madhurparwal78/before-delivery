import pg from "pg";
import { randomBytes } from "node:crypto";
import { config } from "./config.ts";
import { databaseUnavailable } from "./errors.ts";

pg.types.setTypeParser(20, (value) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 12, connectionTimeoutMillis: 4000 });
pool.on("error", () => undefined);

export const newId = (): string => randomBytes(9).toString("base64url");

export type Db = pg.PoolClient | pg.Pool;

export async function query<Row extends pg.QueryResultRow = pg.QueryResultRow>(
  db: Db,
  text: string,
  values: unknown[] = [],
): Promise<Row[]> {
  return (await db.query<Row>(text, values)).rows;
}

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

const UNREACHABLE = new Set(["ECONNREFUSED", "ENOTFOUND", "ETIMEDOUT", "ECONNRESET", "EPIPE", "57P01", "57P02", "57P03", "08000", "08001", "08003", "08004", "08006"]);

export function isDatabaseDown(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const code = (error as { code?: unknown }).code;
  const message = (error as { message?: unknown }).message;
  return (typeof code === "string" && UNREACHABLE.has(code)) || (typeof message === "string" && /timeout exceeded when trying to connect|Connection terminated|Client has encountered a connection error/.test(message));
}

let ready = false;

/** Throws the 503 for API routes until the schema is applied, and whenever Postgres stops answering while serving. */
export async function requireDatabase(): Promise<void> {
  if (!ready) throw databaseUnavailable();
  await pool.query("SELECT 1");
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  reduce_motion boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email ON users (lower(email));
CREATE TABLE IF NOT EXISTS verification_tokens (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS logins (
  token_hash text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS schools (
  id text PRIMARY KEY,
  name text NOT NULL,
  instructor_id text NOT NULL UNIQUE REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS classes (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS class_members (
  class_id text NOT NULL REFERENCES classes(id),
  user_id text NOT NULL REFERENCES users(id),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, user_id)
);
CREATE TABLE IF NOT EXISTS invitations (
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES classes(id),
  email text NOT NULL,
  token_hash text NOT NULL UNIQUE,
  sent_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS aerodromes (
  id text PRIMARY KEY,
  school_id text REFERENCES schools(id),
  name text NOT NULL,
  code text NOT NULL,
  layout jsonb NOT NULL,
  imported boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS scenarios (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES schools(id),
  name text NOT NULL,
  doc jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS assignments (
  id text PRIMARY KEY,
  class_id text NOT NULL REFERENCES classes(id),
  scenario_id text NOT NULL REFERENCES scenarios(id),
  due_on text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  school_id text NOT NULL REFERENCES schools(id),
  scenario_id text NOT NULL REFERENCES scenarios(id),
  assignment_id text REFERENCES assignments(id),
  setup jsonb NOT NULL,
  state jsonb NOT NULL,
  status text NOT NULL,
  rev integer NOT NULL DEFAULT 1,
  last_tick_ms bigint NOT NULL,
  ended_on text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sessions_status ON sessions (status);
CREATE TABLE IF NOT EXISTS seats (
  session_id text NOT NULL REFERENCES sessions(id),
  position text NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  disconnected_at timestamptz,
  PRIMARY KEY (session_id, position)
);
CREATE TABLE IF NOT EXISTS session_log (
  id bigserial PRIMARY KEY,
  session_id text NOT NULL REFERENCES sessions(id),
  sim_time integer NOT NULL,
  position text NOT NULL,
  kind text NOT NULL,
  text text NOT NULL,
  rule text,
  severity text,
  callsign text
);
CREATE INDEX IF NOT EXISTS session_log_session ON session_log (session_id, id);
CREATE TABLE IF NOT EXISTS session_frames (
  session_id text NOT NULL REFERENCES sessions(id),
  t integer NOT NULL,
  frame jsonb NOT NULL,
  PRIMARY KEY (session_id, t)
);
CREATE TABLE IF NOT EXISTS grading_keys (
  kind text NOT NULL,
  key text NOT NULL,
  id text NOT NULL,
  PRIMARY KEY (kind, key)
);
CREATE TABLE IF NOT EXISTS reports (
  session_id text NOT NULL REFERENCES sessions(id),
  kind text NOT NULL,
  user_id text NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, kind)
);
`;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Applies the schema, retrying until Postgres answers; the server serves health meanwhile. */
export async function connectDatabase(): Promise<void> {
  for (;;) {
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT pg_advisory_lock(4173)");
        await client.query(SCHEMA);
        await client.query("SELECT pg_advisory_unlock(4173)");
      } finally {
        client.release();
      }
      ready = true;
      return;
    } catch {
      await sleep(1000);
    }
  }
}
