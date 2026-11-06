export const SCHEMA_SQL = `
create table if not exists owner_account (
  id uuid primary key,
  email text not null,
  display_name text not null,
  password_hash text not null
);

create table if not exists workspace_settings (
  id int primary key,
  home_time_zone text not null,
  theme text not null
);

create table if not exists object_type (
  id uuid primary key,
  name text not null,
  builtin boolean not null default false,
  library_rank integer not null,
  created_at timestamptz not null default now()
);
create unique index if not exists object_type_name_key on object_type (lower(name));

create table if not exists type_field (
  id uuid primary key,
  type_id uuid not null references object_type(id) on delete cascade,
  name text not null,
  kind text not null,
  required boolean not null default false,
  options jsonb,
  target_type_id uuid references object_type(id) on delete cascade,
  position integer not null
);
create unique index if not exists type_field_name_key on type_field (type_id, lower(name));

create table if not exists object_note (
  id uuid primary key,
  type_id uuid not null references object_type(id),
  title text not null,
  daily_date date,
  share_visibility text not null default 'follow',
  backlinks integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists object_note_daily_key on object_note (daily_date) where daily_date is not null;

create table if not exists property_value (
  object_id uuid not null references object_note(id) on delete cascade,
  field_id uuid not null references type_field(id) on delete cascade,
  value jsonb,
  primary key (object_id, field_id)
);

create table if not exists attachment (
  id uuid primary key,
  object_id uuid not null references object_note(id) on delete cascade,
  filename text not null,
  content_type text not null,
  size_bytes bigint not null,
  storage_key text not null,
  created_at timestamptz not null default now()
);

create table if not exists block (
  id uuid primary key,
  object_id uuid not null references object_note(id) on delete cascade,
  kind text not null,
  position integer not null,
  body text,
  version integer not null default 1,
  origin_block_id uuid references block(id) on delete cascade,
  attachment_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists block_object_idx on block (object_id, position);
create index if not exists block_origin_idx on block (origin_block_id);

create table if not exists block_revision (
  id bigserial primary key,
  block_id uuid not null references block(id) on delete cascade,
  version integer not null,
  body text not null,
  ops jsonb,
  change_kind text not null,
  label text not null,
  created_at timestamptz not null default now(),
  unique (block_id, version)
);

create table if not exists link_edge (
  id uuid primary key,
  from_object_id uuid not null references object_note(id) on delete cascade,
  to_object_id uuid not null references object_note(id) on delete cascade,
  kind text not null,
  field_id uuid references type_field(id) on delete cascade,
  block_id uuid references block(id) on delete cascade,
  created_at timestamptz not null default now()
);
create index if not exists link_edge_to_idx on link_edge (to_object_id);
create index if not exists link_edge_from_idx on link_edge (from_object_id);

create table if not exists collection (
  id uuid primary key,
  name text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists collection_name_key on collection (lower(name));

create table if not exists collection_member (
  collection_id uuid not null references collection(id) on delete cascade,
  object_id uuid not null references object_note(id) on delete cascade,
  primary key (collection_id, object_id)
);

create table if not exists board_position (
  collection_id uuid not null references collection(id) on delete cascade,
  object_id uuid not null references object_note(id) on delete cascade,
  x integer not null,
  y integer not null,
  primary key (collection_id, object_id)
);

create table if not exists share_link (
  id uuid primary key,
  collection_id uuid not null references collection(id) on delete cascade,
  token text not null unique,
  expires_at_utc timestamptz not null,
  time_zone text not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table if not exists saved_query (
  id uuid primary key,
  name text not null,
  type_id uuid not null references object_type(id) on delete cascade,
  text text not null,
  group_by text,
  sort jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists device_session (
  id uuid primary key,
  secret text not null unique,
  csrf_token text not null,
  label text not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists sign_in_failure (
  id bigserial primary key,
  identity text not null,
  kind text not null,
  created_at timestamptz not null default now()
);
create index if not exists sign_in_failure_idx on sign_in_failure (kind, identity, created_at);

create table if not exists idempotency_record (
  key text not null,
  endpoint text not null,
  request_body jsonb not null,
  status integer,
  response_body jsonb,
  created_at timestamptz not null default now(),
  primary key (key, endpoint)
);

create table if not exists sync_event (
  id bigserial primary key,
  type text not null,
  data jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists presence (
  session_id uuid not null,
  block_id uuid not null references block(id) on delete cascade,
  anchor integer not null,
  head integer not null,
  version integer not null,
  label text not null,
  updated_at timestamptz not null default now(),
  primary key (session_id, block_id)
);
`;
