-- Core tables. Every domain adds its own numbered file; all statements are idempotent.
create table if not exists meta (
  key text primary key,
  value text not null
);

create table if not exists clock_state (
  id int primary key check (id = 1),
  offset_ns bigint not null default 0,
  frozen boolean not null default false,
  frozen_at timestamptz
);

create table if not exists users (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null check (role in ('responder', 'lead', 'admin', 'stakeholder')),
  timezone text not null,
  quiet_start text,
  quiet_end text,
  notification_delays int[] not null default '{5,15}',
  low_urgency_delay int not null default 0,
  removed_at timestamptz,
  created_at timestamptz not null
);

create table if not exists sessions (
  token_hash text primary key,
  user_id text not null references users (id),
  created_at timestamptz not null
);
create index if not exists sessions_user on sessions (user_id);

-- Replayable live messages; seq is the socket sequence.
create table if not exists live_log (
  seq bigint primary key,
  type text not null,
  at timestamptz not null,
  data jsonb not null
);

create table if not exists idempotency (
  key text primary key,
  fingerprint text not null,
  status int not null,
  body bytea not null,
  created_at timestamptz not null
);

-- Pending timers of every kind; the earliest due one is applied first (see App.settle).
create table if not exists timers (
  id bigserial,
  kind text not null,
  ref text not null,
  due_at timestamptz not null,
  primary key (kind, ref)
);
create index if not exists timers_due on timers (due_at, id);

create table if not exists api_keys (
  id text primary key,
  name text not null,
  scope text not null check (scope in ('read', 'write')),
  prefix text not null,
  created_at timestamptz not null,
  revoked_at timestamptz
);

-- One row per issued secret of a key; a rotation adds a row and sets grace_ends_at on the previous one.
create table if not exists api_key_secrets (
  hash text primary key,
  key_id text not null references api_keys (id),
  created_at timestamptz not null,
  grace_ends_at timestamptz
);
