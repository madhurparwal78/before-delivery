export const schemaSql = `
create table if not exists staff (
  id text primary key,
  name text not null,
  role text not null,
  sort int not null
);

create table if not exists lenders (
  id text primary key,
  name text not null,
  email text not null,
  sort int not null
);

create table if not exists exhibitions (
  id text primary key,
  title text not null,
  museum text not null,
  time_zone text not null,
  run_start date not null,
  run_end date not null,
  open_hours_per_day int not null,
  closed_weekdays int[] not null
);

create table if not exists galleries (
  id text primary key,
  exhibition_id text not null references exhibitions(id),
  name text not null
);

create table if not exists walls (
  id text primary key,
  gallery_id text not null references galleries(id),
  name text not null,
  length_mm int not null,
  height_mm int not null,
  planned_lux int not null,
  sort int not null
);

create table if not exists loan_objects (
  id text primary key,
  object_number text not null unique,
  title text not null,
  medium text not null,
  lender_id text references lenders(id),
  width_mm int not null,
  height_mm int not null,
  lux_limit int not null,
  lux_hour_budget bigint not null,
  insurance_value_gbp bigint not null,
  registrar_note text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists placements (
  id text primary key,
  object_id text not null references loan_objects(id),
  wall_id text not null references walls(id),
  offset_mm int not null,
  centre_height_mm int not null,
  height_override boolean not null default false,
  status text not null,
  claimed_by text references staff(id),
  planned_lux int not null,
  planned_lux_hours bigint not null,
  lux_status text not null,
  version int not null default 1,
  created_at timestamptz not null default now()
);

create unique index if not exists placements_live_per_object
  on placements (object_id) where status <> 'removed';

create table if not exists condition_photos (
  id text primary key,
  object_id text not null references loan_objects(id),
  key text not null,
  bytes int not null,
  sha256 text not null,
  content_type text not null,
  attached_at timestamptz not null default now()
);

create table if not exists event_counter (
  id int primary key,
  value bigint not null
);

create table if not exists events (
  seq bigint primary key,
  kind text not null,
  at timestamptz not null default now(),
  actor_id text references staff(id),
  placement_id text,
  object_id text,
  wall_id text,
  preview_id text,
  title text,
  wall_name text,
  offset_mm int,
  planned_lux int,
  publish_at_display text,
  recipient_count int
);

create table if not exists undo_actions (
  id text primary key,
  kind text not null,
  staff_id text not null references staff(id),
  placement_id text not null references placements(id),
  undo_until timestamptz not null,
  undone boolean not null default false,
  version_after int not null,
  previous jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists previews (
  id text primary key,
  exhibition_id text not null references exhibitions(id),
  status text not null,
  date date,
  publish_at timestamptz,
  published_at timestamptz,
  withdrawn_at timestamptz,
  sort bigserial,
  created_at timestamptz not null default now()
);

create table if not exists preview_recipients (
  preview_id text not null references previews(id),
  lender_id text not null references lenders(id),
  token text not null unique,
  delivery text not null,
  sent_at timestamptz,
  snapshot_json_key text not null,
  snapshot_png_key text not null,
  snapshot_json bytea not null,
  snapshot_png bytea not null,
  notice_pending boolean not null default false,
  primary key (preview_id, lender_id)
);

create table if not exists idempotency_records (
  staff_id text not null,
  route text not null,
  key text not null,
  request_hash text not null,
  status int not null,
  body bytea not null,
  created_at timestamptz not null default now(),
  primary key (staff_id, route, key)
);
`;
