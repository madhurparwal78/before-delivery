import pg from "pg";
import { config } from "./config";

// Postgres is the system of record. Money columns (numeric) come back as exact strings, and
// every timestamp as a UTC ISO string with its full microseconds, so a time the API hands
// out (an as_of, say) names exactly the moment stored.
pg.types.setTypeParser(1184, (value) => `${value.replace(" ", "T").replace(/\+00(:00)?$/, "")}Z`);

export const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 16, options: "-c TimeZone=UTC" });
pool.on("error", (error) => console.error("postgres pool error:", error.message));

export type Db = pg.Pool | pg.PoolClient;
export type Tx = pg.PoolClient;

export async function rows<T>(db: Db, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await db.query(sql, params);
  return result.rows as T[];
}

export async function maybeOne<T>(db: Db, sql: string, params: unknown[] = []): Promise<T | null> {
  return (await rows<T>(db, sql, params))[0] ?? null;
}

export async function one<T>(db: Db, sql: string, params: unknown[] = []): Promise<T> {
  const row = await maybeOne<T>(db, sql, params);
  if (row === null) throw new Error("expected one row");
  return row;
}

/** Runs reads one after another, as a transaction's client takes one query at a time. */
export async function sequence<T extends unknown[]>(...reads: { [K in keyof T]: () => Promise<T[K]> }): Promise<T> {
  const results: unknown[] = [];
  for (const read of reads) results.push(await read());
  return results as T;
}

interface Hooks {
  beforeCommit: Array<() => Promise<void>>;
  afterCommit: Array<() => void>;
}

const hooks = new WeakMap<Tx, Hooks>();

function hooksOf(tx: Tx): Hooks {
  const found = hooks.get(tx);
  if (!found) throw new Error("not inside a transaction");
  return found;
}

/** An object that lives exactly as long as the current transaction on this client. */
export function transactionScope(tx: Tx): object {
  return hooksOf(tx);
}

/**
 * Runs just before the transaction commits, in the order registered: the event log
 * writes its records here, last, so each commit takes its sequence numbers in commit order.
 */
export function beforeCommit(tx: Tx, work: () => Promise<void>): void {
  hooksOf(tx).beforeCommit.push(work);
}

/** Runs after a successful commit (sending mail, waking event streams). */
export function afterCommit(tx: Tx, work: () => void): void {
  hooksOf(tx).afterCommit.push(work);
}

/** Runs `work` in one transaction: changes that belong together commit together. */
export async function transaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  const own: Hooks = { beforeCommit: [], afterCommit: [] };
  hooks.set(client, own);
  try {
    await client.query("BEGIN");
    const result = await work(client);
    for (let index = 0; index < own.beforeCommit.length; index += 1) await own.beforeCommit[index]!();
    await client.query("COMMIT");
    for (const done of own.afterCommit) done();
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    hooks.delete(client);
    client.release();
  }
}

/** Waits up to 60 seconds for Postgres to accept connections, then gives up. */
export async function waitForDatabase(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      if (Date.now() > deadline) throw error;
      console.error("waiting for postgres:", (error as Error).message);
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS firms (
  id uuid PRIMARY KEY,
  name text NOT NULL
);
CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  phone text,
  password_hash text NOT NULL,
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  person_id uuid NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS sessions_person ON sessions(person_id);
CREATE TABLE IF NOT EXISTS jobs (
  id uuid PRIMARY KEY,
  firm_id uuid NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  address text NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'walkthrough', 'closed_out')),
  next_item_number integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  position bigserial
);
CREATE TABLE IF NOT EXISTS plan_revisions (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  transform jsonb NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES people(id),
  uploaded_by_role text NOT NULL,
  moved integer NOT NULL DEFAULT 0,
  needs_review integer NOT NULL DEFAULT 0,
  awaiting_seed_upload boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id, revision)
);
CREATE TABLE IF NOT EXISTS job_members (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id),
  role text NOT NULL CHECK (role IN ('owner', 'lead', 'trade', 'homeowner')),
  trade text,
  ended_at timestamptz,
  position bigserial
);
CREATE UNIQUE INDEX IF NOT EXISTS job_members_one_active_role ON job_members(job_id, person_id) WHERE ended_at IS NULL;
CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  outline jsonb NOT NULL,
  position bigserial
);
CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  trade text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'ready_for_check', 'verified')),
  pin_x double precision,
  pin_y double precision,
  pin_status text NOT NULL DEFAULT 'unpinned' CHECK (pin_status IN ('placed', 'unpinned', 'needs_review')),
  cost_note text,
  quantity numeric(7, 3),
  unit_cost numeric(7, 2),
  sent_back_reason text,
  created_by uuid NOT NULL REFERENCES people(id),
  created_by_role text NOT NULL,
  set_by jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (job_id, number)
);
CREATE TABLE IF NOT EXISTS item_blockers (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  blocker_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, blocker_id)
);
CREATE INDEX IF NOT EXISTS item_blockers_blocker ON item_blockers(blocker_id);
CREATE TABLE IF NOT EXISTS item_conflicts (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  field text NOT NULL,
  server_value jsonb NOT NULL,
  server_by uuid NOT NULL REFERENCES people(id),
  phone_value jsonb NOT NULL,
  phone_by uuid NOT NULL REFERENCES people(id),
  PRIMARY KEY (item_id, field)
);
CREATE TABLE IF NOT EXISTS item_changes (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('created', 'changed', 'deleted')),
  deleted_number integer,
  deleted_title text,
  changed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS item_changes_job ON item_changes(job_id, changed_at);
CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  parent_id uuid REFERENCES notes(id) ON DELETE CASCADE,
  audience text NOT NULL CHECK (audience IN ('crew', 'everyone')),
  author_id uuid NOT NULL REFERENCES people(id),
  author_role text NOT NULL,
  body text NOT NULL,
  rev integer NOT NULL DEFAULT 0,
  state jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  position bigserial
);
CREATE TABLE IF NOT EXISTS note_revisions (
  note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  rev integer NOT NULL,
  author_id uuid NOT NULL REFERENCES people(id),
  author_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (note_id, rev)
);
CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('defect', 'completion')),
  object_key text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  uploaded_by uuid NOT NULL REFERENCES people(id),
  uploaded_by_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  position bigserial
);
CREATE TABLE IF NOT EXISTS visit_series (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  member_id uuid NOT NULL REFERENCES job_members(id) ON DELETE CASCADE,
  starts_local text NOT NULL,
  ends_local text NOT NULL,
  recurrence jsonb,
  dates jsonb NOT NULL,
  position bigserial
);
CREATE TABLE IF NOT EXISTS visit_exceptions (
  visit_id uuid NOT NULL REFERENCES visit_series(id) ON DELETE CASCADE,
  date text NOT NULL,
  status text NOT NULL CHECK (status IN ('moved', 'cancelled')),
  starts_local text,
  ends_local text,
  PRIMARY KEY (visit_id, date)
);
CREATE TABLE IF NOT EXISTS access_cards (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  lockbox_code text NOT NULL DEFAULT '',
  alarm_code text NOT NULL DEFAULT '',
  garage_code text NOT NULL DEFAULT '',
  house_note text NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS code_reveals (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id),
  role text NOT NULL,
  revealed_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS change_orders (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(7, 2) NOT NULL,
  approved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  position bigserial
);
CREATE TABLE IF NOT EXISTS contingency_settings (
  id bigserial PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  percent numeric(4, 2) NOT NULL,
  effective_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS sync_operations (
  op_id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES people(id),
  content jsonb NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('applied', 'conflict')),
  item_id uuid,
  client_item_id uuid,
  client_note_id uuid,
  note_id uuid,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS sync_operations_client_item ON sync_operations(job_id, client_item_id)
  WHERE client_item_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS sync_operations_client_note ON sync_operations(job_id, client_note_id)
  WHERE client_note_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS outbox (
  id uuid PRIMARY KEY,
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('assignment', 'summary')),
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent')),
  claimed_until timestamptz,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  sent_at timestamptz,
  position bigserial
);
CREATE INDEX IF NOT EXISTS outbox_queued ON outbox(position) WHERE status = 'queued';
CREATE TABLE IF NOT EXISTS daily_summaries (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  local_date text NOT NULL,
  queued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (job_id, local_date)
);
CREATE TABLE IF NOT EXISTS event_log (
  job_id uuid NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq bigint NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY (job_id, seq)
);
CREATE TABLE IF NOT EXISTS event_heads (
  job_id uuid PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  seq bigint NOT NULL DEFAULT 0,
  counts text,
  costs text
);
`;

/** Applies the schema idempotently; an advisory lock keeps concurrent starts apart. */
export async function migrate(): Promise<void> {
  await transaction(async (tx) => {
    await tx.query("SELECT pg_advisory_xact_lock(4173)");
    await tx.query(SCHEMA);
  });
}
