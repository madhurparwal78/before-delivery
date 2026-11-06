import { db, withAdvisoryLock } from './db.js';

const DDL = `
create table if not exists firms (
  id uuid primary key,
  name text not null
);

create table if not exists people (
  id uuid primary key,
  name text not null,
  email text not null unique,
  phone text,
  password_hash text not null,
  is_owner boolean not null default false,
  firm_id uuid references firms(id),
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  person_id uuid not null references people(id),
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists jobs (
  id uuid primary key,
  firm_id uuid not null references firms(id),
  name text not null,
  address text not null,
  time_zone text not null,
  status text not null,
  created_at timestamptz not null,
  item_seq integer not null default 0,
  room_seq integer not null default 0,
  event_seq bigint not null default 0
);

create table if not exists job_members (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  person_id uuid not null references people(id),
  role text not null,
  trade text,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create unique index if not exists job_members_person on job_members (job_id, person_id);

create table if not exists rooms (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  name text not null,
  outline jsonb not null,
  position integer not null,
  created_at timestamptz not null
);
create unique index if not exists rooms_job_name on rooms (job_id, lower(name));

create table if not exists plan_revisions (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  revision integer not null,
  object_key text not null,
  content_type text not null,
  reference_points jsonb,
  uploaded_by uuid not null references people(id),
  created_at timestamptz not null,
  moved integer not null default 0,
  needs_review integer not null default 0
);
create unique index if not exists plan_revisions_number on plan_revisions (job_id, revision);

create table if not exists items (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  number integer not null,
  title text not null,
  room_id uuid not null references rooms(id),
  trade text,
  status text not null,
  pin_x integer,
  pin_y integer,
  pin_status text not null,
  cost_note text,
  quantity bigint,
  unit_cost bigint,
  sent_back_reason text,
  last_by text,
  created_by uuid not null references people(id),
  created_at timestamptz not null,
  updated_at timestamptz not null
);
create unique index if not exists items_job_number on items (job_id, number);

create table if not exists item_blockers (
  item_id uuid not null references items(id) on delete cascade,
  blocker_id uuid not null references items(id) on delete cascade,
  primary key (item_id, blocker_id)
);

create table if not exists item_conflicts (
  item_id uuid not null references items(id) on delete cascade,
  field text not null,
  server_value jsonb,
  server_by text not null,
  phone_value jsonb,
  phone_by text not null,
  primary key (item_id, field)
);

create table if not exists notes (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  item_id uuid not null references items(id) on delete cascade,
  parent_id uuid references notes(id) on delete cascade,
  audience text not null,
  author_id uuid not null references people(id),
  doc jsonb not null,
  rev integer not null,
  body text not null,
  created_at timestamptz not null
);

create table if not exists photos (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  item_id uuid not null references items(id) on delete cascade,
  kind text not null,
  content_type text not null,
  bytes integer not null,
  object_key text not null,
  uploaded_by uuid not null references people(id),
  created_at timestamptz not null
);

create table if not exists visits (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  member_id uuid not null references job_members(id) on delete cascade,
  starts_local text not null,
  ends_local text not null,
  recurrence jsonb,
  created_at timestamptz not null
);

create table if not exists visit_exceptions (
  visit_id uuid not null references visits(id) on delete cascade,
  occurrence_date text not null,
  status text not null,
  starts_local text,
  ends_local text,
  primary key (visit_id, occurrence_date)
);

create table if not exists access_cards (
  job_id uuid primary key references jobs(id),
  lockbox_code text not null default '',
  alarm_code text not null default '',
  garage_code text not null default '',
  house_note text not null default ''
);

create table if not exists code_reveals (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  person_id uuid not null references people(id),
  revealed_at timestamptz not null
);

create table if not exists change_orders (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  description text not null,
  amount bigint not null,
  status text not null,
  created_at timestamptz not null,
  approved_at timestamptz
);

create table if not exists contingency_settings (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  percent bigint not null,
  effective_at timestamptz not null
);

create table if not exists operation_log (
  job_id uuid not null references jobs(id),
  op_id uuid not null,
  type text not null,
  content text not null,
  outcome text not null,
  item_id uuid,
  created_at timestamptz not null,
  primary key (job_id, op_id)
);

create table if not exists client_ids (
  job_id uuid not null references jobs(id),
  kind text not null,
  client_id text not null,
  server_id uuid not null,
  primary key (job_id, kind, client_id)
);

create table if not exists events (
  job_id uuid not null references jobs(id),
  seq bigint not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  primary key (job_id, seq)
);

create table if not exists outbox (
  id uuid primary key,
  job_id uuid not null references jobs(id),
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null,
  created_at timestamptz not null,
  sent_at timestamptz,
  claimed_at timestamptz
);

create table if not exists summary_runs (
  job_id uuid not null references jobs(id),
  local_date text not null,
  cut_off timestamptz not null,
  primary key (job_id, local_date)
);

create table if not exists item_changes (
  id bigserial primary key,
  job_id uuid not null references jobs(id),
  item_id uuid not null,
  number integer not null,
  title text not null,
  kind text not null,
  at timestamptz not null
);
create index if not exists item_changes_job_at on item_changes (job_id, at);

create table if not exists seed_markers (
  key text primary key,
  applied_at timestamptz not null default now()
);
`;

const SCHEMA_LOCK = 718_324_101;

export async function applySchema(): Promise<void> {
  await withAdvisoryLock(SCHEMA_LOCK, async () => {
    await db.query(DDL);
  });
}

export async function withSeedLock<T>(run: () => Promise<T>): Promise<T> {
  return withAdvisoryLock(SCHEMA_LOCK + 1, run);
}
