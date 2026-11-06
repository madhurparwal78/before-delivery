import pg from "pg";
import type { PoolClient } from "pg";

export type Db = pg.Pool;

export function createDb(databaseUrl: string): Db {
  return new pg.Pool({
    connectionString: databaseUrl,
    max: 20,
    idleTimeoutMillis: 30000,
  });
}

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS firms (
  id text PRIMARY KEY,
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  firm_id text NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  password_hash text NOT NULL,
  is_owner boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS people_firm_email ON people (firm_id, lower(email));

CREATE TABLE IF NOT EXISTS jobs (
  id text PRIMARY KEY,
  firm_id text NOT NULL REFERENCES firms(id),
  name text NOT NULL,
  address text NOT NULL,
  time_zone text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  next_item_number integer NOT NULL DEFAULT 1,
  next_event_seq integer NOT NULL DEFAULT 0,
  summary_cutoff_at timestamptz,
  summary_for_date date,
  last_change_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS rooms (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  name text NOT NULL,
  outline jsonb NOT NULL,
  sort_order integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (job_id, sort_order)
);

CREATE TABLE IF NOT EXISTS plan_revisions (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  revision integer NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  reference_points jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  uploaded_by text NOT NULL REFERENCES people(id),
  moved integer NOT NULL DEFAULT 0,
  needs_review integer NOT NULL DEFAULT 0,
  PRIMARY KEY (job_id, revision)
);

CREATE TABLE IF NOT EXISTS job_members (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  person_id text NOT NULL REFERENCES people(id),
  role text NOT NULL,
  trade text,
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);

CREATE INDEX IF NOT EXISTS job_members_job ON job_members (job_id) WHERE ended_at IS NULL;

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  person_id text NOT NULL REFERENCES people(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  number integer NOT NULL,
  title text NOT NULL,
  room_id text NOT NULL REFERENCES rooms(id),
  trade text,
  status text NOT NULL DEFAULT 'open',
  pin_x numeric(7,4),
  pin_y numeric(7,4),
  pin_status text NOT NULL DEFAULT 'unpinned',
  cost_note text,
  quantity numeric(7,3),
  unit_cost numeric(9,2),
  sent_back_reason text,
  created_by text NOT NULL REFERENCES job_members(id),
  last_edited_by text REFERENCES job_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz,
  UNIQUE (job_id, number)
);

CREATE INDEX IF NOT EXISTS items_job ON items (job_id) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS item_links (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  blocker_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, blocker_id)
);

CREATE TABLE IF NOT EXISTS item_photos (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  kind text NOT NULL,
  object_key text NOT NULL,
  content_type text NOT NULL,
  bytes integer NOT NULL,
  uploaded_by text NOT NULL REFERENCES job_members(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  parent_id text REFERENCES notes(id),
  body text NOT NULL,
  audience text NOT NULL,
  author_id text NOT NULL REFERENCES job_members(id),
  rev integer NOT NULL DEFAULT 0,
  chars jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS note_revisions (
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  rev integer NOT NULL,
  kind text NOT NULL,
  author_id text NOT NULL REFERENCES job_members(id),
  edit_json jsonb,
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (note_id, rev)
);

CREATE TABLE IF NOT EXISTS note_undo_state (
  note_id text NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES job_members(id),
  undone_rev integer,
  undone_at timestamptz,
  PRIMARY KEY (note_id, member_id)
);

CREATE TABLE IF NOT EXISTS conflicts (
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  field text NOT NULL,
  server_value jsonb,
  server_by text NOT NULL REFERENCES job_members(id),
  phone_value jsonb,
  phone_by text NOT NULL REFERENCES job_members(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, field)
);

CREATE TABLE IF NOT EXISTS client_item_map (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  item_id text NOT NULL REFERENCES items(id),
  PRIMARY KEY (job_id, client_id)
);

CREATE TABLE IF NOT EXISTS client_note_map (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  client_id text NOT NULL,
  note_id text NOT NULL REFERENCES notes(id),
  PRIMARY KEY (job_id, client_id)
);

CREATE TABLE IF NOT EXISTS op_log (
  op_id text NOT NULL,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  content jsonb NOT NULL,
  outcome text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (op_id, job_id)
);

CREATE TABLE IF NOT EXISTS visits (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES job_members(id),
  starts_at_local text NOT NULL,
  ends_at_local text NOT NULL,
  starts_at_utc timestamptz NOT NULL,
  ends_at_utc timestamptz NOT NULL,
  recurrence jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS visit_occurrences (
  visit_id text NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
  date text NOT NULL,
  starts_at_utc timestamptz NOT NULL,
  ends_at_utc timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'scheduled',
  PRIMARY KEY (visit_id, date)
);

CREATE INDEX IF NOT EXISTS visit_occ_member ON visits (job_id, member_id);

CREATE TABLE IF NOT EXISTS access_cards (
  job_id text PRIMARY KEY REFERENCES jobs(id) ON DELETE CASCADE,
  lockbox_code text NOT NULL DEFAULT '',
  alarm_code text NOT NULL DEFAULT '',
  garage_code text NOT NULL DEFAULT '',
  house_note text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS access_reveals (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  member_id text NOT NULL REFERENCES job_members(id),
  revealed_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS change_orders (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  description text NOT NULL,
  amount numeric(9,2) NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_at timestamptz
);

CREATE TABLE IF NOT EXISTS contingency_settings (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  effective_at timestamptz NOT NULL,
  percent numeric(5,2) NOT NULL,
  PRIMARY KEY (job_id, effective_at)
);

CREATE TABLE IF NOT EXISTS item_changes (
  id bigserial PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  number integer NOT NULL,
  title text NOT NULL,
  kind text NOT NULL,
  at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS item_changes_job ON item_changes (job_id, at);

CREATE TABLE IF NOT EXISTS events (
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (job_id, seq)
);

CREATE TABLE IF NOT EXISTS outbox (
  id text PRIMARY KEY,
  job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  kind text NOT NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  link text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  send_after timestamptz NOT NULL DEFAULT now(),
  claimed_by text,
  summary_date date
);

CREATE INDEX IF NOT EXISTS outbox_pending ON outbox (status, send_after);
CREATE UNIQUE INDEX IF NOT EXISTS outbox_summary_once ON outbox (job_id, summary_date, to_email) WHERE kind = 'summary';
`;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}

export async function withTransaction<T>(db: Db, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // connection already broken
    }
    throw e;
  } finally {
    client.release();
  }
}
