import type { Database } from './db.js';

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  state text NOT NULL DEFAULT 'trialing',
  trial_ends_at timestamptz NOT NULL,
  trial_notice_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  time_zone text NOT NULL,
  threshold_minutes integer NOT NULL DEFAULT 360,
  feed_token text NOT NULL UNIQUE,
  invite_token text,
  invite_used boolean NOT NULL DEFAULT false,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS members_email_key ON members (lower(email)) WHERE removed_at IS NULL;
CREATE INDEX IF NOT EXISTS members_workspace_idx ON members (workspace_id);

CREATE TABLE IF NOT EXISTS sessions_auth (
  token_hash text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  title text NOT NULL,
  estimate_minutes integer,
  day_date date,
  position integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  source text,
  external_id text,
  due_date date,
  version integer NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tasks_member_key_idx ON tasks (member_id, source, external_id);
CREATE INDEX IF NOT EXISTS tasks_member_day_idx ON tasks (member_id, day_date);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  task_id text NOT NULL UNIQUE REFERENCES tasks(id),
  member_id text NOT NULL REFERENCES members(id),
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS meetings (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  uid text NOT NULL,
  summary text NOT NULL,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS meetings_member_uid_idx ON meetings (member_id, uid);

CREATE TABLE IF NOT EXISTS routines (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  name text NOT NULL,
  start_time text NOT NULL,
  duration_minutes integer NOT NULL,
  repeats text NOT NULL
);

CREATE TABLE IF NOT EXISTS idempotency (
  member_id text NOT NULL,
  key text NOT NULL,
  request_hash text NOT NULL,
  status integer NOT NULL,
  body jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, key)
);

CREATE TABLE IF NOT EXISTS outbox (
  id bigserial PRIMARY KEY,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  claimed_by text,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (status, id);

CREATE TABLE IF NOT EXISTS import_batches (
  id text PRIMARY KEY,
  member_id text NOT NULL REFERENCES members(id),
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created integer NOT NULL DEFAULT 0,
  updated integer NOT NULL DEFAULT 0,
  unchanged integer NOT NULL DEFAULT 0,
  skipped integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS billing_events (
  event_id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id),
  type text NOT NULL,
  occurred_at timestamptz NOT NULL,
  seats integer,
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS billing_events_workspace_idx ON billing_events (workspace_id);

CREATE TABLE IF NOT EXISTS digest_log (
  member_id text NOT NULL REFERENCES members(id),
  day_date date NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, day_date)
);

CREATE TABLE IF NOT EXISTS seed_state (
  key text PRIMARY KEY,
  value text NOT NULL
);
`;

export async function applySchema(db: Database): Promise<void> {
  await db.query(SCHEMA_SQL);
}

export async function schemaApplied(db: Database): Promise<boolean> {
  const rows = await db.query<{ exists: boolean }>(
    "SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'workspaces') AS exists",
  );
  return rows[0]?.exists === true;
}
