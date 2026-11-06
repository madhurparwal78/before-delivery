export const SCHEMA_SQL = `
create table if not exists meta (
  key text primary key,
  value text not null
);

create table if not exists tasks (
  number integer primary key,
  title text not null,
  details text not null default '',
  department text,
  label text,
  status text not null,
  priority integer not null,
  owner text,
  cycle text,
  parent integer references tasks (number),
  duplicate_of integer references tasks (number),
  request text unique,
  version integer not null default 1,
  updated_at timestamptz not null default now()
);

create table if not exists relations (
  blocker integer not null references tasks (number),
  blocked integer not null references tasks (number),
  primary key (blocker, blocked)
);

create table if not exists cycles (
  key text primary key,
  position integer not null,
  starts_at timestamptz not null,
  ends_at timestamptz
);

create table if not exists changes (
  seq bigserial primary key,
  kind text not null,
  actor text,
  at timestamptz not null default now(),
  undoable boolean not null default false,
  undone boolean not null default false,
  result jsonb,
  undo_data jsonb
);

create table if not exists activity (
  id bigserial primary key,
  task integer not null references tasks (number),
  at timestamptz not null default now(),
  actor text,
  kind text not null,
  changes jsonb not null default '{}'::jsonb,
  change bigint not null
);

create index if not exists activity_task_idx on activity (task, id);

create table if not exists attachments (
  id uuid primary key,
  task integer not null references tasks (number),
  file_name text not null,
  kind text not null,
  size bigint not null,
  content_type text not null,
  object_key text not null,
  created_at timestamptz not null default now()
);

create index if not exists attachments_task_idx on attachments (task, created_at desc);

create table if not exists idempotency (
  key text primary key,
  method text not null,
  path text not null,
  body_hash text not null,
  status integer,
  response jsonb,
  created_at timestamptz not null default now()
);
`;
