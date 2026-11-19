export const SCHEMA = `
create table if not exists assessors (
  id text primary key,
  name text not null,
  email text not null unique,
  password_hash text not null,
  created_at bigint not null
);

create table if not exists sessions (
  id text primary key,
  assessor_id text not null references assessors(id) on delete cascade,
  created_at bigint not null,
  ends_at bigint not null,
  ended boolean not null default false
);

create table if not exists labels (
  id text primary key,
  assessor_id text not null references assessors(id) on delete cascade,
  name text not null,
  contact_name text,
  contact_email text,
  state text not null default 'open',
  closed_at bigint,
  erase_at bigint,
  created_at bigint not null,
  sort_index bigint not null
);

create table if not exists suppliers (
  id text primary key,
  label_id text not null references labels(id) on delete cascade,
  name text not null,
  town text not null,
  language text not null,
  contact_name text,
  contact_email text,
  first_sent_at bigint not null,
  unique (label_id, name)
);

create table if not exists styles (
  id text primary key,
  assessor_id text not null references assessors(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  style_code text,
  name text not null,
  season text not null,
  gtin text not null,
  garment text not null default 'tshirt',
  washes integer not null default 30,
  repair_service boolean,
  range_size integer,
  notes text,
  state text not null default 'draft',
  version integer not null default 1,
  changed_at bigint not null,
  changed_by text,
  created_at bigint not null,
  sort_index bigint not null
);

create table if not exists material_lines (
  id text primary key,
  style_id text not null references styles(id) on delete cascade,
  position integer not null,
  material_id text not null,
  fabric_weight_gsm numeric,
  area_m2 numeric,
  mass_grams numeric not null,
  fibres jsonb not null,
  tier1 jsonb,
  tier2 jsonb,
  tier3 jsonb,
  answered_energy_mj numeric,
  answered_water_litres numeric,
  answered_origin text,
  created_at bigint not null
);

create table if not exists transport_legs (
  id text primary key,
  style_id text not null references styles(id) on delete cascade,
  position integer not null,
  mode text not null,
  km numeric not null,
  created_at bigint not null
);

create table if not exists supplier_requests (
  id text primary key,
  assessor_id text not null references assessors(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  style_id text not null references styles(id) on delete cascade,
  line_id text not null references material_lines(id) on delete cascade,
  supplier_id text not null references suppliers(id) on delete cascade,
  supplier_name text not null,
  contact_name text,
  contact_email text,
  town text not null,
  language text not null,
  questions jsonb not null,
  due_date text not null,
  state text not null default 'sent',
  sent_at bigint not null,
  ends_at bigint not null,
  reminded_at bigint,
  answered_at bigint,
  token text not null unique,
  token_ended boolean not null default false,
  answer jsonb,
  sort_index bigint not null
);

create table if not exists evidence_files (
  id text primary key,
  request_id text not null references supplier_requests(id) on delete cascade,
  assessor_id text not null references assessors(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  file_name text not null,
  size_bytes integer not null,
  content_type text not null,
  object_key text not null,
  created_at bigint not null
);

create table if not exists visits (
  id text primary key,
  assessor_id text not null references assessors(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  factory_name text not null,
  town text not null,
  local_date text not null,
  local_time text not null,
  at bigint not null,
  created_at bigint not null
);

create table if not exists readings (
  id text primary key,
  visit_id text not null references visits(id) on delete cascade,
  meter integer not null,
  value numeric not null,
  unit text not null,
  taken_at bigint not null,
  created_at bigint not null,
  sort_index bigint not null
);

create table if not exists request_keys (
  assessor_id text not null references assessors(id) on delete cascade,
  key text not null,
  body_hash text not null,
  status integer not null,
  body jsonb not null,
  created_at bigint not null,
  primary key (assessor_id, key)
);

create table if not exists results (
  id text primary key,
  style_id text not null references styles(id) on delete cascade,
  edition text not null,
  worked_out_at bigint not null,
  data_quality_percent integer not null,
  data_quality_grade text not null,
  measures jsonb not null,
  factor_rows jsonb not null,
  input jsonb not null,
  is_current boolean not null default true,
  sort_index bigint not null
);

create table if not exists scenarios (
  id text primary key,
  style_id text not null references styles(id) on delete cascade,
  name text not null,
  result_id text not null references results(id) on delete cascade,
  saved_at bigint not null,
  changes jsonb not null,
  measures jsonb not null,
  differences jsonb not null,
  sort_index bigint not null
);

create table if not exists scores (
  style_id text primary key references styles(id) on delete cascade,
  state text not null,
  score integer,
  per100g integer,
  run_id text,
  body_hash text,
  worst_case jsonb not null default '[]'::jsonb,
  busy_until bigint,
  asked_at bigint
);

create table if not exists passports (
  id text primary key,
  style_id text not null references styles(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  gtin text not null,
  edition integer not null,
  state text not null default 'published',
  published_at bigint not null,
  corrected_on text,
  snapshot jsonb not null,
  unique (gtin, edition)
);

create table if not exists published_gtins (
  gtin text primary key,
  style_id text not null,
  withdrawn boolean not null default false
);

create table if not exists dossiers (
  id text primary key,
  style_id text not null references styles(id) on delete cascade,
  label_id text not null references labels(id) on delete cascade,
  result_id text not null references results(id) on delete cascade,
  edition text not null,
  state text not null,
  made_at bigint not null,
  signed_off_by text,
  signed_off_at bigint,
  object_key text,
  token text unique,
  token_ends_at bigint,
  token_ended boolean not null default false,
  sort_index bigint not null
);

create table if not exists rate_events (
  id text primary key,
  assessor_id text not null references assessors(id) on delete cascade,
  kind text not null,
  at bigint not null
);

create table if not exists editions_seen (
  edition text primary key,
  valid_from text not null,
  seen_at bigint not null
);

create table if not exists mail_outbox (
  id text primary key,
  label_id text references labels(id) on delete cascade,
  recipient text not null,
  subject text not null,
  body text not null,
  send_after bigint not null,
  sent_at bigint,
  sort_index bigint not null
);

create table if not exists file_deletions (
  id text primary key,
  object_key text not null unique,
  label_id text,
  done boolean not null default false
);

create table if not exists ended_pages (
  token text primary key,
  kind text not null,
  language text not null,
  ended_at bigint not null
);

create table if not exists seed_marker (
  id integer primary key,
  done boolean not null
);

create index if not exists material_lines_style on material_lines(style_id, position);
create index if not exists transport_legs_style on transport_legs(style_id, position);
create index if not exists styles_label on styles(label_id);
create index if not exists results_style on results(style_id, sort_index desc);
create index if not exists requests_assessor on supplier_requests(assessor_id, sort_index);
create index if not exists readings_visit on readings(visit_id, sort_index);
create index if not exists rate_events_assessor on rate_events(assessor_id, kind, at);
create index if not exists dossiers_style on dossiers(style_id, sort_index desc);
create index if not exists passports_style on passports(style_id, edition);
`;
