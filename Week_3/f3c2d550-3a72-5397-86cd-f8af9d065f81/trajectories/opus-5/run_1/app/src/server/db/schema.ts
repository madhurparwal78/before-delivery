import { SEED_HOME_ZONE, SEED_ZONE_EFFECTIVE_FROM } from '../../shared/seed.js';

export const SCHEMA_SQL = `
create table if not exists app_settings (
  id integer primary key default 1 check (id = 1),
  unit text not null default 'mm'
);

create table if not exists zone_history (
  effective_from timestamptz primary key,
  zone text not null
);

create table if not exists reference (
  id text primary key,
  state text not null check (state in ('stored', 'trashed', 'purged')),
  version integer not null,
  title text not null,
  maker text,
  year integer,
  materials text[] not null default '{}',
  finish text,
  colour_family text not null,
  source_url text,
  source_note text,
  notes text,
  width_tenths integer not null,
  height_tenths integer not null,
  depth_tenths integer not null,
  swatch text not null,
  swatch_source text not null check (swatch_source in ('computed', 'eyedropper')),
  captured_at timestamptz not null,
  trashed_at timestamptz,
  purge_at timestamptz,
  photo_content_type text not null,
  photo_bytes bigint not null,
  photo_sha256 text not null,
  photo_width integer not null,
  photo_height integer not null,
  original_key text not null,
  display_key text not null
);

create index if not exists reference_state_captured_idx
  on reference (state, captured_at desc, id desc);
create index if not exists reference_purge_idx on reference (purge_at) where state = 'trashed';

create table if not exists reel (
  id text primary key,
  name text not null,
  demo boolean not null default false,
  version integer not null default 1,
  created_at timestamptz not null
);

create table if not exists reel_stop (
  reel_id text not null references reel (id) on delete cascade,
  position integer not null,
  reference_id text not null references reference (id) on delete cascade,
  primary key (reel_id, position),
  unique (reel_id, reference_id)
);

create index if not exists reel_stop_reference_idx on reel_stop (reference_id);

create table if not exists sheet (
  id text primary key,
  reel_id text not null references reel (id) on delete cascade,
  reel_name text not null,
  state text not null check (state in ('queued', 'rendering', 'ready', 'failed')),
  paper text not null check (paper in ('a4', 'letter')),
  unit text not null check (unit in ('mm', 'in')),
  requested_at timestamptz not null,
  ready_at timestamptz,
  pdf_bytes bigint,
  pdf_sha256 text,
  failure_count integer not null default 0,
  next_attempt_at timestamptz not null,
  claimed_at timestamptz,
  snapshot jsonb not null
);

create index if not exists sheet_reel_idx on sheet (reel_id, requested_at desc);
create index if not exists sheet_queue_idx on sheet (state, next_attempt_at);

create table if not exists daily_pull (
  pull_day date primary key,
  reference_id text not null references reference (id) on delete cascade,
  zone text not null,
  picked_at timestamptz not null
);

create table if not exists idempotency (
  method text not null,
  path text not null,
  key text not null,
  state text not null check (state in ('in_flight', 'recorded')),
  fingerprint text,
  status integer,
  body jsonb,
  created_at timestamptz not null,
  primary key (method, path, key)
);

create index if not exists idempotency_created_idx on idempotency (created_at);

create table if not exists search_update (
  seq bigserial primary key,
  reference_id text not null,
  op text not null check (op in ('upsert', 'delete')),
  recorded_at timestamptz not null,
  applied_at timestamptz
);

create index if not exists search_update_pending_idx on search_update (seq) where applied_at is null;

insert into app_settings (id, unit) values (1, 'mm') on conflict (id) do nothing;
insert into zone_history (effective_from, zone)
  values (timestamptz '${SEED_ZONE_EFFECTIVE_FROM}', '${SEED_HOME_ZONE}')
  on conflict (effective_from) do nothing;
`;
