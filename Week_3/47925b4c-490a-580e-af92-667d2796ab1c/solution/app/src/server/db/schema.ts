export const SCHEMA_SQL = `
create table if not exists models (
  code text primary key,
  kind text not null,
  rated_lumens integer,
  rated_hours integer,
  native_width_px integer,
  native_height_px integer,
  watts integer,
  ratio_min numeric(10,4),
  ratio_max numeric(10,4),
  shift_across_percent numeric(10,4),
  shift_down_percent numeric(10,4)
);

create table if not exists sites (
  id text primary key,
  name text not null,
  width_metres numeric(18,6) not null,
  height_metres numeric(18,6) not null,
  columns integer not null,
  rows integer not null,
  show_at timestamptz not null,
  show_at_local text not null,
  demo boolean not null default false,
  rectified boolean not null default false,
  residual_metres numeric(18,3),
  homography jsonb,
  tiles jsonb,
  photo_sha256 text,
  photo_bytes bigint,
  photo_file_name text,
  photo_width_px integer,
  photo_height_px integer,
  photo_orientation integer,
  photo_key text,
  created_at timestamptz not null default now()
);

create table if not exists cells (
  site_id text not null references sites(id) on delete cascade,
  cell text not null,
  reflectance numeric(18,6) not null default 0.6,
  recess_metres numeric(18,6) not null default 0,
  primary key (site_id, cell)
);

create table if not exists readings (
  id uuid primary key,
  operation_id text not null unique,
  site_id text not null references sites(id) on delete cascade,
  cell text not null,
  entered_text text not null,
  entered_unit text not null,
  canonical_lux numeric(24,6) not null,
  captured_at timestamptz not null,
  counted_at timestamptz not null,
  accepted_at timestamptz not null
);

create index if not exists readings_counted on readings (site_id, cell, counted_at desc, accepted_at desc);

create table if not exists circuits (
  id uuid primary key,
  site_id text not null references sites(id) on delete cascade,
  name text not null,
  kind text not null,
  created_at timestamptz not null default now()
);

create table if not exists units (
  serial text primary key,
  kind text not null,
  model text not null references models(code),
  location text not null,
  hired boolean not null default false,
  logged_hours numeric(18,6) not null default 0
);

create table if not exists movements (
  id uuid primary key,
  kind text not null,
  serial text not null references units(serial),
  at timestamptz not null default now(),
  reverses_id uuid references movements(id)
);

create index if not exists movements_order on movements (at desc, id desc);

create table if not exists movement_entries (
  movement_id uuid not null references movements(id) on delete cascade,
  position integer not null,
  location text not null,
  delta integer not null,
  primary key (movement_id, position)
);

create table if not exists holds (
  id uuid primary key,
  status text not null,
  model text not null,
  from_day date not null,
  days integer not null,
  hold_ref text,
  serial text,
  logged_hours numeric(18,6),
  expires_at timestamptz,
  quote jsonb,
  confirm_pending boolean not null default false,
  hand_back boolean not null default false,
  release_needed boolean not null default false,
  release_answered boolean not null default false,
  next_attempt_at timestamptz not null default now(),
  claim_until timestamptz,
  fence bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists layouts (
  id text primary key,
  site_id text not null references sites(id) on delete cascade,
  name text not null,
  version bigint not null default 1,
  hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists placements (
  id uuid primary key,
  layout_id text not null references layouts(id) on delete cascade,
  placed_at timestamptz not null default now(),
  ordinal bigint not null,
  body_serial text,
  hold_id uuid references holds(id),
  model text not null references models(code),
  lens_serial text not null,
  aim_across numeric(18,6) not null,
  aim_down numeric(18,6) not null,
  body_across numeric(18,6) not null,
  body_down numeric(18,6) not null,
  standoff numeric(18,6) not null,
  ratio numeric(18,6) not null,
  shift_across_percent numeric(18,6) not null,
  shift_down_percent numeric(18,6) not null,
  circuit_id uuid not null references circuits(id)
);

create unique index if not exists placements_one_body on placements (layout_id, body_serial) where body_serial is not null;
create unique index if not exists placements_one_lens on placements (layout_id, lens_serial);
create index if not exists placements_layout on placements (layout_id, ordinal);

create sequence if not exists placement_ordinal;

create table if not exists issue_attempts (
  id uuid primary key,
  layout_id text not null references layouts(id) on delete cascade,
  sheet_id uuid not null,
  state text not null,
  started_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now()
);

create table if not exists sheets (
  id uuid primary key,
  layout_id text not null references layouts(id) on delete cascade,
  version integer not null,
  status text not null,
  issued_at timestamptz not null,
  layout_hash text not null,
  sha256 text not null,
  bytes bigint not null,
  object_key text not null,
  lowest_contrast double precision,
  link_ends_at timestamptz not null
);

create unique index if not exists sheets_active on sheets (layout_id) where status <> 'Withdrawn';

create table if not exists serial_bindings (
  serial text primary key,
  attempt_id uuid,
  sheet_id uuid references sheets(id) on delete cascade
);

create table if not exists sheet_links (
  token text primary key,
  sheet_id uuid not null references sheets(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists sheet_links_one_active on sheet_links (sheet_id) where active;

create table if not exists link_requests (
  id bigserial primary key,
  token text not null,
  at timestamptz not null default now()
);

create index if not exists link_requests_window on link_requests (token, at desc);

create table if not exists circuit_confirmations (
  sheet_id uuid not null references sheets(id) on delete cascade,
  circuit_id uuid not null references circuits(id) on delete cascade,
  live boolean not null,
  confirmed_at timestamptz not null,
  primary key (sheet_id, circuit_id)
);

create table if not exists mask_jobs (
  id uuid primary key,
  layout_id text not null references layouts(id) on delete cascade,
  layout_hash text not null,
  phase text not null,
  steps_done integer not null default 0,
  steps_total integer not null,
  sha256 text,
  object_key text,
  snapshot jsonb not null,
  cancel_requested boolean not null default false,
  claim_until timestamptz,
  fence bigint not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists idempotency_keys (
  method text not null,
  path text not null,
  key text not null,
  request_hash text not null,
  state text not null,
  status integer,
  response_body jsonb,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  primary key (method, path, key)
);

create table if not exists events (
  id uuid primary key,
  ordinal bigserial not null,
  sequence bigint unique,
  type text not null,
  aggregate text not null,
  aggregate_id text not null,
  at timestamptz not null default now(),
  data jsonb not null,
  sheet_id uuid
);

create index if not exists events_unsequenced on events (ordinal) where sequence is null;
create index if not exists events_sequence on events (sequence);

create table if not exists event_counter (
  id integer primary key,
  value bigint not null
);

insert into event_counter (id, value) values (1, 0) on conflict (id) do nothing;
`;
