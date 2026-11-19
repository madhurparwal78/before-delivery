export const SCHEMA_SQL = `
create table if not exists owner_master (
  id text primary key,
  name text not null,
  email text not null unique,
  passcode_hash text not null,
  created_at_utc timestamptz not null default now()
);

create table if not exists vessel (
  id text primary key,
  owner_id text not null references owner_master(id),
  name text not null,
  kind text not null,
  initial_offset_minutes integer not null,
  created_at_utc timestamptz not null default now()
);

create table if not exists crew_member (
  id text primary key,
  vessel_id text not null references vessel(id),
  name text not null,
  rank text not null,
  email text not null unique,
  passcode_hash text not null,
  created_at_utc timestamptz not null default now()
);

create table if not exists app_session (
  token text primary key,
  person_id text not null,
  role text not null,
  created_at_utc timestamptz not null default now()
);

create table if not exists position_fix (
  id text primary key,
  vessel_id text not null references vessel(id),
  at_utc timestamptz not null,
  latitude double precision not null,
  longitude double precision not null,
  unique (vessel_id, at_utc)
);

create table if not exists clock_change (
  id text primary key,
  vessel_id text not null references vessel(id),
  changes_at_utc timestamptz not null,
  old_offset_minutes integer not null,
  new_offset_minutes integer not null,
  latitude double precision not null,
  longitude double precision not null,
  fix_id text references position_fix(id),
  unique (vessel_id, changes_at_utc)
);

create table if not exists rule_set_period (
  id text primary key,
  vessel_id text not null references vessel(id),
  rule_set text not null,
  effective_from_utc timestamptz not null,
  effective_until_utc timestamptz not null,
  flag_reference text not null
);

create table if not exists rota_watch (
  id text primary key,
  vessel_id text not null references vessel(id),
  crew_id text not null references crew_member(id),
  label text not null,
  start_time text not null,
  end_time text not null,
  from_date date not null,
  to_date date not null
);

create table if not exists watch_entry (
  seq bigserial primary key,
  id text not null unique,
  crew_id text not null references crew_member(id),
  entry_key text not null,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  kind text not null,
  ship_date date not null,
  late boolean not null,
  applied boolean not null,
  received_at_utc timestamptz not null,
  unique (crew_id, entry_key)
);

create index if not exists watch_entry_crew_range on watch_entry (crew_id, start_utc);

create table if not exists day_signature (
  crew_id text not null references crew_member(id),
  ship_date date not null,
  signed_at_utc timestamptz,
  countersigned_at_utc timestamptz,
  primary key (crew_id, ship_date)
);

create table if not exists day_note (
  id text primary key,
  crew_id text not null references crew_member(id),
  ship_date date not null,
  text text not null,
  event_id text,
  author_role text not null,
  author_id text not null,
  created_at_utc timestamptz not null
);

create table if not exists vessel_event (
  id text primary key,
  vessel_id text not null references vessel(id),
  crew_id text not null references crew_member(id),
  kind text not null,
  start_utc timestamptz not null,
  end_utc timestamptz not null,
  description text not null
);

create table if not exists breach_record (
  id text primary key,
  crew_id text not null references crew_member(id),
  rule text not null,
  window_hours integer not null,
  window_start_utc timestamptz not null,
  rule_set text not null,
  rest_hours double precision not null,
  recorded_at_utc timestamptz not null,
  unique (crew_id, window_hours, window_start_utc, rule)
);

create table if not exists month_state (
  crew_id text not null references crew_member(id),
  month text not null,
  state text not null,
  record_key text,
  record_sha256 text,
  copy_key text,
  sealed_at_utc timestamptz,
  primary key (crew_id, month)
);

create table if not exists inspection_link (
  id text primary key,
  vessel_id text not null references vessel(id),
  token text not null unique,
  from_date date not null,
  to_date date not null,
  expires_at_utc timestamptz not null,
  revoked_at_utc timestamptz,
  created_at_utc timestamptz not null
);
`;
