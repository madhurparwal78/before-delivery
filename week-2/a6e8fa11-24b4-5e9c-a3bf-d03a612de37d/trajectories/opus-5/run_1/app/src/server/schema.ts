export const SCHEMA_SQL = `
create table if not exists stations (
  id uuid primary key,
  name text not null unique,
  time_zone text not null
);

create table if not exists members (
  id uuid primary key,
  station_id uuid not null references stations(id) on delete cascade,
  name text not null,
  email text not null unique,
  role text not null,
  status text not null,
  password_hash text,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id uuid primary key,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists invites (
  token text primary key,
  member_id uuid not null references members(id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);

create table if not exists workbooks (
  id uuid primary key,
  station_id uuid not null references stations(id) on delete cascade,
  name text not null,
  state text not null,
  closes_at_local text,
  closes_at_utc timestamptz,
  original_key text,
  head_seq integer not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists workbooks_station_idx on workbooks (station_id, updated_at desc);

create table if not exists ops (
  workbook_id uuid not null references workbooks(id) on delete cascade,
  seq integer not null,
  author_id uuid not null,
  type text not null,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workbook_id, seq)
);

create table if not exists request_keys (
  member_id uuid not null references members(id) on delete cascade,
  endpoint text not null,
  scope_id uuid not null,
  key text not null,
  body_hash text not null,
  status integer,
  response text,
  created_at timestamptz not null default now(),
  primary key (member_id, endpoint, scope_id, key)
);

create table if not exists conflicts (
  id uuid primary key,
  workbook_id uuid not null references workbooks(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  kind text not null,
  sheet_id uuid not null,
  sheet_name text not null,
  cell text not null,
  my_input text not null,
  current_input text not null default '',
  current_author_id uuid references members(id) on delete set null,
  reason text,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  choice text
);

create index if not exists conflicts_open_idx on conflicts (workbook_id, member_id, resolved_at);

create table if not exists versions (
  id uuid primary key,
  workbook_id uuid not null references workbooks(id) on delete cascade,
  number integer not null,
  label text not null,
  kind text not null,
  seq integer not null,
  object_key text not null,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  unique (workbook_id, number)
);

create table if not exists exports (
  id uuid primary key,
  workbook_id uuid not null references workbooks(id) on delete cascade,
  member_id uuid not null references members(id) on delete cascade,
  format text not null,
  sheet_id uuid,
  file_name text not null,
  status text not null,
  seq integer not null,
  object_key text,
  origin text not null,
  created_at timestamptz not null default now(),
  ready_at timestamptz
);

create index if not exists exports_pending_idx on exports (status);

create table if not exists share_links (
  id uuid primary key,
  workbook_id uuid not null references workbooks(id) on delete cascade,
  token text not null unique,
  lifetime_seconds integer not null,
  expires_at timestamptz not null,
  status text not null,
  created_at timestamptz not null default now()
);

create table if not exists mail_queue (
  id uuid primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);

create index if not exists mail_queue_pending_idx on mail_queue (status, created_at);
`;
