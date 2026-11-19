export const SCHEMA_SQL = `
create table if not exists workspaces (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null,
  trial_ends_at timestamptz not null,
  killbill_account_id text,
  seed_key text unique
);

create table if not exists members (
  id uuid primary key,
  workspace_id uuid references workspaces(id) on delete cascade,
  name text not null,
  email text not null,
  email_lower text not null,
  password_hash text not null,
  role text not null check (role in ('owner', 'member', 'operator')),
  time_zone text not null,
  threshold_minutes integer not null default 360,
  status text not null check (status in ('active', 'invited', 'pending_billing', 'removed')),
  feed_token text,
  invite_token text,
  invite_used_at timestamptz,
  killbill_subscription_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists members_email_unique
  on members (email_lower) where status <> 'removed';
create unique index if not exists members_feed_token_unique
  on members (feed_token) where feed_token is not null;
create unique index if not exists members_invite_token_unique
  on members (invite_token) where invite_token is not null;

create table if not exists auth_sessions (
  token text primary key,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists tasks (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  title text not null,
  estimate_minutes integer,
  day_date date,
  position integer not null default 0,
  status text not null check (status in ('open', 'done')),
  source text,
  external_id text,
  due_date date,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists tasks_member_external_unique
  on tasks (member_id, source, external_id) where external_id is not null;
create index if not exists tasks_member_day on tasks (member_id, day_date);

create table if not exists task_sessions (
  id uuid primary key,
  task_id uuid not null unique references tasks(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  local_date date not null,
  start_time text not null,
  end_time text not null,
  start_instant timestamptz not null,
  end_instant timestamptz not null,
  version integer not null default 1,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create index if not exists task_sessions_member_date on task_sessions (member_id, local_date);

create table if not exists routines (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  name text not null,
  start_time text not null,
  duration_minutes integer not null,
  repeats text not null check (repeats in ('daily', 'weekdays')),
  created_at timestamptz not null
);

create table if not exists meetings (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  uid text not null,
  summary text not null,
  start_instant timestamptz not null,
  end_instant timestamptz not null,
  created_at timestamptz not null,
  updated_at timestamptz not null
);

create unique index if not exists meetings_member_uid_unique on meetings (member_id, uid);

create table if not exists import_batches (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  kind text not null check (kind in ('tasks', 'calendar')),
  created_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  merged_count integer not null default 0,
  rejected_count integer not null default 0,
  skipped_count integer not null default 0,
  created_at timestamptz not null
);

create index if not exists import_batches_workspace on import_batches (workspace_id, created_at desc);

create table if not exists idempotency_records (
  member_id uuid not null references members(id) on delete cascade,
  key text not null,
  request_hash text not null,
  response_status integer,
  response_body jsonb,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (member_id, key)
);

create table if not exists billing_events (
  event_id text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  type text not null,
  occurred_at timestamptz not null,
  seats integer,
  received_at timestamptz not null
);

create index if not exists billing_events_workspace on billing_events (workspace_id, occurred_at);

create table if not exists outbox (
  id bigserial primary key,
  kind text not null,
  payload jsonb not null,
  dedupe_key text,
  status text not null default 'pending' check (status in ('pending', 'sent')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  claimed_by text,
  claimed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create unique index if not exists outbox_dedupe_unique on outbox (dedupe_key) where dedupe_key is not null;
create index if not exists outbox_pending on outbox (status, next_attempt_at);

create table if not exists digest_log (
  member_id uuid not null references members(id) on delete cascade,
  local_date date not null,
  created_at timestamptz not null,
  primary key (member_id, local_date)
);

create table if not exists trial_notices (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  queued_at timestamptz not null
);
`;
