import pg from "pg";
import { config } from "./config.js";

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 20 });
pool.on("error", () => undefined);

export type Db = pg.Pool | pg.PoolClient;

export async function query<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  const result = await db.query<T>(sql, params);
  return result.rows;
}

export async function one<T extends pg.QueryResultRow>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | null> {
  const rows = await query<T>(sql, params, db);
  return rows[0] ?? null;
}

/** Runs `work` in one transaction. */
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

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL,
  email_lower text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS forms (
  id uuid PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  owner_id uuid NOT NULL REFERENCES users,
  title text NOT NULL,
  draft jsonb NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  field_revs jsonb NOT NULL DEFAULT '{}',
  state text NOT NULL DEFAULT 'draft',
  closed_reason text,
  live_edition integer,
  closes_at timestamptz,
  closes_local text,
  response_limit integer,
  closed_message text,
  copy_to text,
  submitted_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS form_editors (
  form_id uuid NOT NULL REFERENCES forms ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  added_at timestamptz NOT NULL,
  PRIMARY KEY (form_id, user_id)
);
CREATE TABLE IF NOT EXISTS editions (
  form_id uuid NOT NULL REFERENCES forms ON DELETE CASCADE,
  number integer NOT NULL,
  definition text NOT NULL,
  published_at timestamptz NOT NULL,
  PRIMARY KEY (form_id, number)
);
CREATE TABLE IF NOT EXISTS responses (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms ON DELETE CASCADE,
  edition integer NOT NULL,
  status text NOT NULL,
  answers jsonb NOT NULL DEFAULT '{}',
  page text NOT NULL,
  device text,
  former_devices text[] NOT NULL DEFAULT '{}',
  resume_token text UNIQUE,
  resume_email text,
  saved_at timestamptz,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  submitted_at timestamptz,
  calc_values jsonb
);
CREATE INDEX IF NOT EXISTS responses_form_status ON responses (form_id, status);
CREATE INDEX IF NOT EXISTS responses_device ON responses (device, form_id);
CREATE TABLE IF NOT EXISTS idempotency (
  key text PRIMARY KEY,
  response_id uuid NOT NULL,
  body_hash text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS files (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms ON DELETE CASCADE,
  response_id uuid NOT NULL REFERENCES responses ON DELETE CASCADE,
  question_key text NOT NULL,
  name text NOT NULL,
  size integer NOT NULL,
  type text NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS invitations (
  token_hash text PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms ON DELETE CASCADE,
  email text NOT NULL,
  inviter_id uuid NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz
);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  form_id uuid NOT NULL REFERENCES forms ON DELETE CASCADE,
  object_key text NOT NULL,
  responses integer NOT NULL,
  created_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  created_at timestamptz NOT NULL,
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS app_clock (
  id integer PRIMARY KEY,
  offset_ms bigint NOT NULL
);
`;

const SCHEMA_LOCK = 7_310_442;

/** Waits for Postgres, then applies the schema idempotently. */
export async function prepareDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock($1)", [SCHEMA_LOCK]);
    await client.query(SCHEMA);
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [SCHEMA_LOCK]).catch(() => undefined);
    client.release();
  }
}
