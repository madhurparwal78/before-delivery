/** The schema, applied idempotently on every start. */

export const SCHEMA_SQL = `
create table if not exists missions (
  id uuid primary key,
  seq bigserial,
  name text not null,
  epoch_ms bigint not null,
  distance_unit text not null,
  speed_unit text not null,
  reference_target text,
  reference_state text,
  reference_fetched_ms bigint,
  reference_etag text,
  reference_etag_url text,
  change_version bigint not null default 0,
  created_ms bigint not null
);

create table if not exists passes (
  id uuid primary key,
  mission_id uuid not null references missions(id) on delete cascade,
  upload_seq bigserial,
  filename text not null,
  state text not null,
  size_bytes bigint not null,
  sha256 text not null,
  sample_count integer not null default 0,
  transcript_line_count integer not null default 0,
  rejected_line integer,
  rejected_reason text,
  is_seed boolean not null default false,
  parse_attempts integer not null default 0,
  created_ms bigint not null
);
create index if not exists passes_mission_idx on passes (mission_id, upload_seq);
create index if not exists passes_live_sha_idx on passes (mission_id, sha256) where state <> 'deleted';

create table if not exists samples (
  pass_id uuid not null references passes(id) on delete cascade,
  line_no integer not null,
  mission_id uuid not null,
  upload_seq bigint not null,
  met bigint not null,
  utc_ms bigint not null,
  x_m double precision not null,
  y_m double precision not null,
  z_m double precision not null,
  vx_m_s double precision not null,
  vy_m_s double precision not null,
  vz_m_s double precision not null,
  lat_deg double precision not null,
  lon_deg double precision not null,
  altitude_m double precision not null,
  speed_m_s double precision not null,
  residual_m double precision,
  primary key (pass_id, line_no)
);
create index if not exists samples_track_idx on samples (mission_id, met, upload_seq, line_no);

create table if not exists transcript_lines (
  id uuid primary key,
  pass_id uuid not null references passes(id) on delete cascade,
  mission_id uuid not null,
  upload_seq bigint not null,
  line_no integer not null,
  met bigint not null,
  utc_ms bigint not null,
  speaker text not null,
  text text not null
);
create index if not exists transcript_order_idx on transcript_lines (mission_id, met, upload_seq, line_no);

create table if not exists events (
  id uuid primary key,
  mission_id uuid not null references missions(id) on delete cascade,
  pass_id uuid not null references passes(id) on delete cascade,
  met bigint not null,
  title text not null,
  note text,
  created_ms bigint not null,
  seq bigserial
);
create index if not exists events_order_idx on events (mission_id, met, created_ms);

create table if not exists landmarks (
  id uuid primary key,
  mission_id uuid not null references missions(id) on delete cascade,
  seq bigserial,
  name text not null,
  name_key text not null,
  lat_deg double precision not null,
  lon_deg double precision not null,
  created_ms bigint not null
);
create unique index if not exists landmarks_name_idx on landmarks (mission_id, name_key);

create table if not exists reference_vectors (
  mission_id uuid not null references missions(id) on delete cascade,
  unix_ms bigint not null,
  x_m double precision not null,
  y_m double precision not null,
  z_m double precision not null,
  vx_m_s double precision not null,
  vy_m_s double precision not null,
  vz_m_s double precision not null,
  primary key (mission_id, unix_ms)
);

create table if not exists request_keys (
  mission_id uuid not null references missions(id) on delete cascade,
  route text not null,
  key text not null,
  state text not null,
  fingerprint text not null,
  status integer,
  pass_id uuid,
  event_id uuid,
  created_ms bigint not null,
  primary key (mission_id, route, key)
);

create table if not exists share_links (
  id uuid primary key,
  mission_id uuid not null references missions(id) on delete cascade,
  token text not null unique,
  created_ms bigint not null,
  expires_ms bigint not null,
  revoked boolean not null default false
);
create index if not exists share_active_idx on share_links (mission_id) where revoked = false;

create table if not exists subscribers (
  id text primary key,
  mission_id uuid not null references missions(id) on delete cascade,
  seq bigserial,
  url text not null,
  created_ms bigint not null
);

create table if not exists plan_state (
  id integer primary key,
  plan text not null,
  confirmed_ms bigint not null
);

create table if not exists audit_entries (
  mission_id uuid not null references missions(id) on delete cascade,
  seq bigint not null,
  at_ms bigint not null,
  kind text not null,
  data jsonb not null,
  prev text not null,
  hash text not null,
  primary key (mission_id, seq)
);

create table if not exists pending_search_writes (
  id bigserial primary key,
  op text not null,
  doc_id text,
  ref_id uuid,
  mission_id uuid not null references missions(id) on delete cascade,
  pass_id uuid,
  created_ms bigint not null
);

create table if not exists outbox (
  id uuid primary key,
  kind text not null,
  pass_id uuid,
  event_id text,
  payload jsonb,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz
);
create index if not exists outbox_pending_idx on outbox (created_at) where sent_at is null;

create table if not exists app_singletons (
  name text primary key,
  value text not null,
  created_ms bigint not null
);

alter table passes add column if not exists is_seed boolean not null default false;
alter table passes add column if not exists parse_attempts integer not null default 0;
`;
