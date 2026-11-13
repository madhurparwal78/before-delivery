-- Schedules, layers with their revision history, overrides and calendar tokens. The schedules domain owns every write.
create table if not exists schedules (
  id text primary key,
  name text not null,
  zone text not null,
  record_format int not null default 2 check (record_format in (1, 2)),
  upgraded_at timestamptz,
  version int not null default 1,
  created_at timestamptz not null
);

create table if not exists schedule_layers (
  id text primary key,
  schedule_id text not null references schedules (id),
  seq bigserial,
  version int not null default 1,
  created_at timestamptz not null
);
create index if not exists schedule_layers_schedule on schedule_layers (schedule_id);

-- Every saved form of a layer. A revision computes from effective_from (null: since the beginning) until the next one
-- takes over, so an edit never moves a past block.
create table if not exists schedule_layer_revisions (
  layer_id text not null references schedule_layers (id),
  revision int not null,
  effective_from timestamptz,
  name text not null,
  ord int not null,
  shift_days int not null,
  handoff_time text not null,   -- HH:MM in the schedule zone; HH:MM UTC while the schedule is record_format 1
  start_date text not null,     -- YYYY-MM-DD, a local date in the schedule zone (a UTC date in record_format 1)
  people text[] not null,
  restrictions jsonb not null default '[]',
  primary key (layer_id, revision)
);

create table if not exists schedule_overrides (
  id text primary key,
  schedule_id text not null references schedules (id),
  person_id text,               -- null: a deliberate gap
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  created_at timestamptz not null
);
create index if not exists schedule_overrides_schedule on schedule_overrides (schedule_id, starts_at);

-- One personal calendar feed token per person; a new token replaces the old one.
create table if not exists calendar_tokens (
  user_id text primary key references users (id),
  token_hash text not null unique,
  created_at timestamptz not null,
  expires_at timestamptz not null
);
