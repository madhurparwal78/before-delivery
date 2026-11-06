export const SCHEMA_SQL = `
create table if not exists orgs (
  id text primary key,
  name text not null
);

create table if not exists people (
  id text primary key,
  org_id text not null references orgs(id),
  name text not null,
  email text not null unique,
  password_hash text not null,
  org_role text not null check (org_role in ('admin', 'steward', 'member'))
);

create table if not exists projects (
  slug text primary key,
  name text not null,
  kind text not null,
  code text not null unique,
  floor_pct numeric(5,1) not null,
  buffer_pct numeric(5,1) not null,
  lead_person_id text not null references people(id),
  boundary jsonb not null,
  boundary_area_m2 bigint not null
);

create table if not exists sensors (
  project_slug text not null references projects(slug),
  id text not null,
  kind text not null check (kind in ('tower', 'satellite')),
  polygon jsonb not null,
  primary key (project_slug, id)
);

create table if not exists project_grants (
  person_id text not null references people(id),
  project_slug text not null references projects(slug),
  role text not null check (role in ('viewer', 'analyst', 'sealer')),
  primary key (person_id, project_slug)
);

create table if not exists sessions (
  id text primary key,
  person_id text not null references people(id),
  created_at timestamptz not null,
  expires_at timestamptz not null
);

create table if not exists figure_counters (
  project_slug text primary key references projects(slug),
  next_seq integer not null
);

create table if not exists ingest_batches (
  id text primary key,
  project_slug text not null references projects(slug),
  person_id text not null references people(id),
  created_at timestamptz not null
);

create table if not exists readings (
  project_slug text not null references projects(slug),
  sensor_id text not null,
  interval_start timestamptz not null,
  fc numeric(9,4) not null,
  fch4 numeric(11,4) not null,
  qc smallint not null,
  primary key (project_slug, sensor_id, interval_start)
);

create index if not exists readings_window_idx on readings (project_slug, interval_start);

create table if not exists reading_revisions (
  id bigserial primary key,
  project_slug text not null references projects(slug),
  sensor_id text not null,
  interval_start timestamptz not null,
  old_fc numeric(9,4),
  old_fch4 numeric(11,4),
  old_qc smallint,
  new_fc numeric(9,4) not null,
  new_fch4 numeric(11,4) not null,
  new_qc smallint not null,
  batch_id text not null references ingest_batches(id),
  revised_at timestamptz not null
);

create index if not exists reading_revisions_scope_idx
  on reading_revisions (project_slug, interval_start, sensor_id);

create table if not exists figures (
  id text primary key,
  project_slug text not null references projects(slug),
  start_ts timestamptz not null,
  end_ts timestamptz not null,
  sensor_ids text[] not null,
  status text not null check (status in ('sealed', 'broken', 'superseded')),
  supersedes text references figures(id),
  superseded_by text references figures(id),
  coverage_pct numeric(5,1) not null,
  floor_pct numeric(5,1) not null,
  net_tco2e numeric(20,3) not null,
  co2_tco2e numeric(20,3) not null,
  ch4_tco2e numeric(20,3) not null,
  buffer_pct numeric(5,1) not null,
  buffer_tco2e numeric(20,3) not null,
  credited_tco2e numeric(20,3) not null,
  readings_count integer not null,
  fingerprint text not null,
  sealed_at timestamptz not null,
  sealed_by text not null references people(id),
  checked_at timestamptz not null,
  readings_key text not null,
  derivation_key text not null,
  sealed_revision_id bigint not null,
  seq bigserial not null
);

create index if not exists figures_project_idx on figures (project_slug, seq desc);

create table if not exists figure_contributions (
  figure_id text not null references figures(id),
  sensor_id text not null,
  kind text not null,
  area_m2 bigint not null,
  qualifying_half_hours integer not null,
  half_hours integer not null,
  co2_tco2e numeric(20,3) not null,
  ch4_tco2e numeric(20,3) not null,
  net_tco2e numeric(20,3) not null,
  primary key (figure_id, sensor_id)
);

create table if not exists ledger_entries (
  id text primary key,
  project_slug text not null references projects(slug),
  figure_id text not null references figures(id),
  kind text not null check (kind in ('issuance', 'buffer', 'reversal')),
  tco2e numeric(20,3) not null,
  reverses text references ledger_entries(id),
  recorded_at timestamptz not null,
  seq bigserial not null
);

create index if not exists ledger_project_idx on ledger_entries (project_slug, seq);
create unique index if not exists ledger_one_reversal_idx
  on ledger_entries (reverses) where reverses is not null;

create table if not exists idempotency_records (
  person_id text not null references people(id),
  key text not null,
  request_hash text not null,
  status_code integer not null,
  response_body text not null,
  figure_id text not null references figures(id),
  created_at timestamptz not null,
  expires_at timestamptz not null,
  primary key (person_id, key)
);

create table if not exists regulator_links (
  id text primary key,
  figure_id text not null references figures(id),
  token text not null unique,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  revoked_at timestamptz
);

create table if not exists alert_queue (
  id bigserial primary key,
  figure_id text not null references figures(id),
  moved integer not null,
  reversed_tco2e numeric(20,3) not null,
  recipients text[] not null,
  created_at timestamptz not null,
  sent_at timestamptz
);

create index if not exists alert_queue_pending_idx on alert_queue (id) where sent_at is null;

create table if not exists seed_state (
  key text primary key,
  applied_at timestamptz not null
);
`;
