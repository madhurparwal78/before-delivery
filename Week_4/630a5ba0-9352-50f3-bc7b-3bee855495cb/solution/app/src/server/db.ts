import postgres from "postgres";
import { config } from "./config.js";

export const sql = postgres(config.databaseUrl, {
  max: 24,
  onnotice: () => undefined,
  transform: { undefined: null },
});

export type Tx = postgres.TransactionSql;
export type Db = typeof sql | Tx;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at timestamptz NOT NULL,
  trial_ends_at timestamptz NOT NULL,
  state text NOT NULL DEFAULT 'trialing'
    CHECK (state IN ('trialing','active','past_due','read_only','cancelled')),
  seed_key text UNIQUE
);

CREATE TABLE IF NOT EXISTS members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid REFERENCES workspaces(id),
  role text NOT NULL CHECK (role IN ('owner','member','operator')),
  status text NOT NULL CHECK (status IN ('active','invited','pending_billing')),
  name text,
  email text NOT NULL,
  password_hash text,
  time_zone text NOT NULL,
  threshold_minutes integer NOT NULL DEFAULT 360
    CHECK (threshold_minutes BETWEEN 60 AND 960 AND threshold_minutes % 15 = 0),
  feed_token text NOT NULL UNIQUE,
  invite_token_hash text UNIQUE,
  invite_origin text,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((role = 'operator') = (workspace_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS members_live_email ON members (lower(email)) WHERE removed_at IS NULL;

CREATE TABLE IF NOT EXISTS sign_ins (
  token_hash text PRIMARY KEY,
  member_id uuid NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  estimate_minutes integer CHECK (estimate_minutes BETWEEN 5 AND 600 AND estimate_minutes % 5 = 0),
  day_date date,
  position integer NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','done')),
  source text,
  external_id text,
  due_date date,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external ON tasks (member_id, source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS tasks_member_day ON tasks (member_id, day_date);

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id uuid NOT NULL UNIQUE REFERENCES tasks(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES members(id),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  member_id uuid NOT NULL REFERENCES members(id),
  key text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  body jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS routines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  start_time text NOT NULL,
  duration_minutes integer NOT NULL CHECK (duration_minutes BETWEEN 5 AND 240 AND duration_minutes % 5 = 0),
  repeats text NOT NULL CHECK (repeats IN ('daily','weekdays')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS meetings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id),
  uid text NOT NULL,
  summary text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  UNIQUE (member_id, uid)
);

CREATE TABLE IF NOT EXISTS import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  member_id uuid NOT NULL REFERENCES members(id),
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL CHECK (kind IN ('tasks','calendar')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS digests (
  member_id uuid NOT NULL REFERENCES members(id),
  local_date date NOT NULL,
  PRIMARY KEY (member_id, local_date)
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  kind text NOT NULL CHECK (kind IN ('killbill.register_workspace','killbill.add_seat','mail')),
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  dedupe_key text UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  done_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_due ON outbox (next_attempt_at) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS billing_events (
  event_id text PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  seats integer,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_events_workspace ON billing_events (workspace_id, occurred_at, event_id);
`;

/** Applies the schema under an advisory lock so app copies sharing a database never race. */
export async function migrate(seed: (tx: Tx) => Promise<void>): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(4173)`;
    await tx.unsafe(SCHEMA);
    await seed(tx);
  });
}
