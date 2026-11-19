import pg from "pg";
import { config } from "./config";
import { OPEN_CORRECTION_STATES } from "../shared/types";

// timestamptz -> Date, bigint counters -> number (audio milliseconds and sums stay far below 2^53).
pg.types.setTypeParser(pg.types.builtins.INT8, (value: string) => Number(value));
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (value: string) => Number(value));

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 24, idleTimeoutMillis: 10_000 });
pool.on("error", () => {
  // An idle client lost its connection; the pool replaces it on the next checkout.
});

export type Db = Pick<pg.PoolClient, "query">;

export async function rows<T extends object>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T[]> {
  return (await db.query<T>(sql, params)).rows;
}

export async function one<T extends object>(sql: string, params: unknown[] = [], db: Db = pool): Promise<T | undefined> {
  return (await db.query<T>(sql, params)).rows[0];
}

export async function tx<T>(work: (db: pg.PoolClient) => Promise<T>): Promise<T> {
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

/**
 * The one dedicated connection a live socket or event stream holds while it stays open, labelled
 * lowfield-stream:<session_id>. Releasing before the connect finishes ends it once it does.
 */
export function holdStreamConnection(sessionId: string): { ready: Promise<pg.Client>; release: () => void } {
  const client = new pg.Client({ connectionString: config.databaseUrl, application_name: `lowfield-stream:${sessionId}` });
  client.on("error", () => undefined);
  const ready = client.connect().then(() => client);
  let released = false;
  return {
    ready,
    release: () => {
      if (released) return;
      released = true;
      void ready.then(() => client.end()).catch(() => undefined);
    },
  };
}

export function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && (error as Error & { code?: string }).code === "23505";
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  plan text NOT NULL CHECK (plan IN ('pilot', 'scale')),
  kb_account_id text,
  kb_subscription_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  name text NOT NULL,
  name_key text NOT NULL,
  quota_minutes integer NOT NULL CHECK (quota_minutes BETWEEN 1 AND 1000000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, name_key)
);
CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('admin', 'developer', 'reviewer', 'approver', 'billing')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  removed_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email ON members (lower(email)) WHERE removed_at IS NULL;
CREATE TABLE IF NOT EXISTS member_projects (
  member_id uuid NOT NULL REFERENCES members (id),
  project_id uuid NOT NULL REFERENCES projects (id),
  PRIMARY KEY (member_id, project_id)
);
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members (id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  token_hash text NOT NULL UNIQUE,
  name text NOT NULL,
  email text NOT NULL,
  role text NOT NULL,
  project_ids uuid[] NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS invitations_open_email ON invitations (lower(email)) WHERE used_at IS NULL;
CREATE TABLE IF NOT EXISTS api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id),
  name text NOT NULL,
  prefix text NOT NULL,
  secret_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES projects (id),
  key_id uuid NOT NULL REFERENCES api_keys (id),
  kind text NOT NULL,
  source text NOT NULL,
  label text NOT NULL,
  state text NOT NULL,
  close_reason text,
  channels smallint NOT NULL,
  audio_ms bigint NOT NULL DEFAULT 0,
  frame integer NOT NULL DEFAULT 0,
  peak_bin smallint NOT NULL DEFAULT 0,
  mean real[] NOT NULL DEFAULT '{}',
  plan text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  live_at timestamptz,
  ended_at timestamptz,
  billable_seconds integer,
  billing_state text NOT NULL DEFAULT 'open',
  billing_claimed_at timestamptz,
  owner text,
  close_requested boolean NOT NULL DEFAULT false,
  artifact_stored boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS sessions_project ON sessions (project_id, started_at DESC);
CREATE INDEX IF NOT EXISTS sessions_open ON sessions (owner) WHERE ended_at IS NULL;
CREATE INDEX IF NOT EXISTS sessions_pending ON sessions (billing_state) WHERE billing_state = 'pending';
CREATE TABLE IF NOT EXISTS spectrum_rows (
  session_id uuid NOT NULL REFERENCES sessions (id),
  frame integer NOT NULL,
  bins smallint[] NOT NULL,
  PRIMARY KEY (session_id, frame)
);
CREATE TABLE IF NOT EXISTS segments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES sessions (id),
  idx integer NOT NULL,
  start_ms integer NOT NULL,
  end_ms integer NOT NULL,
  words jsonb NOT NULL,
  text text NOT NULL,
  UNIQUE (session_id, idx)
);
CREATE TABLE IF NOT EXISTS corrections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES segments (id),
  session_id uuid NOT NULL REFERENCES sessions (id),
  author_id uuid NOT NULL REFERENCES members (id),
  state text NOT NULL,
  text text NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  decided_at timestamptz,
  decided_by uuid REFERENCES members (id)
);
CREATE UNIQUE INDEX IF NOT EXISTS corrections_open ON corrections (segment_id) WHERE state IN (${OPEN_CORRECTION_STATES.map((state) => `'${state}'`).join(", ")});
CREATE INDEX IF NOT EXISTS corrections_session ON corrections (session_id);
CREATE TABLE IF NOT EXISTS idempotency_records (
  member_id uuid NOT NULL REFERENCES members (id),
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer,
  body text,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);
CREATE TABLE IF NOT EXISTS plan_changes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES orgs (id),
  target text NOT NULL,
  state text NOT NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS plan_changes_open ON plan_changes (org_id) WHERE state = 'requested';
CREATE TABLE IF NOT EXISTS trial_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  company text NOT NULL,
  team text NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS trial_requests_email ON trial_requests (lower(email));
CREATE TABLE IF NOT EXISTS synthesis_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects (id),
  key_id uuid NOT NULL REFERENCES api_keys (id),
  voice text NOT NULL,
  characters integer NOT NULL,
  duration_ms integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS instances (
  id text PRIMARY KEY,
  seen_at timestamptz NOT NULL
);
`;

/** Lock id shared by every instance on one database while it applies the schema and seed data. */
const SCHEMA_LOCK = 4_173_001;

export async function applySchema(db: pg.PoolClient): Promise<void> {
  await db.query("SELECT pg_advisory_xact_lock($1)", [SCHEMA_LOCK]);
  await db.query(SCHEMA);
}

export async function waitForDatabase(): Promise<void> {
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}
