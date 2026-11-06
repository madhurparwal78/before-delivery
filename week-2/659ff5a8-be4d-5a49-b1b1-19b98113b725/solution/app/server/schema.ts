/** The schema, applied idempotently on every start. */
export const SCHEMA = `
create table if not exists clubs (
  id integer generated always as identity primary key,
  slug text not null unique,
  name text not null,
  time_zone text not null,
  failure_service text,
  failure_event_id integer,
  failure_at timestamptz
);

create table if not exists users (
  id integer generated always as identity primary key,
  club_id integer references clubs(id),
  name text not null,
  email text not null,
  password_hash text not null,
  roles text[] not null default '{}'
);
create unique index if not exists users_email_key on users (lower(email));

create table if not exists sessions (
  token_hash text primary key,
  user_id integer not null references users(id) on delete cascade,
  expires_at timestamptz not null
);

create table if not exists index_tables (
  id integer generated always as identity primary key,
  club_id integer not null references clubs(id),
  effective_date date not null,
  factors jsonb not null,
  created_at timestamptz not null default now(),
  created_by integer references users(id),
  unique (club_id, effective_date)
);

create table if not exists events (
  id integer generated always as identity primary key,
  club_id integer not null references clubs(id),
  name text not null,
  date date not null,
  venue text not null,
  registration_cutoff_local text not null,
  registration_cutoff_utc timestamptz not null,
  runs_per_driver integer not null,
  heat_count integer not null,
  stations text[] not null,
  status text not null default 'draft',
  running_heat integer,
  provisional_at timestamptz,
  protest_window_closes_at timestamptz,
  version integer not null default 1,
  published_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists event_classes (
  event_id integer not null references events(id) on delete cascade,
  class_code text not null,
  heat integer not null,
  position integer not null,
  primary key (event_id, class_code)
);

create table if not exists registrations (
  id integer generated always as identity primary key,
  event_id integer not null references events(id) on delete cascade,
  user_id integer not null references users(id),
  class_code text not null,
  car_number integer not null,
  car_description text not null,
  run_heat integer not null,
  checked_in_at timestamptz,
  waiver_key text,
  waiver_checksum text,
  last_change_run integer,
  last_change_at timestamptz,
  last_change_rank jsonb,
  created_at timestamptz not null default now(),
  constraint registrations_driver_key unique (event_id, user_id),
  constraint registrations_car_key unique (event_id, class_code, car_number)
);

create table if not exists stations (
  id integer generated always as identity primary key,
  event_id integer not null references events(id) on delete cascade,
  heat integer not null,
  name text not null,
  position integer not null,
  worker_registration_id integer references registrations(id) on delete set null
);
create unique index if not exists stations_worker_key on stations (worker_registration_id);

create table if not exists runs (
  id integer generated always as identity primary key,
  registration_id integer not null references registrations(id) on delete cascade,
  run_number integer not null,
  status text not null default 'pending',
  outcome text,
  raw_ms integer,
  cones integer,
  adjusted_ms integer,
  indexed_ms integer,
  factor_bp integer,
  committed_at timestamptz,
  committed_by integer references users(id),
  unique (registration_id, run_number)
);

create table if not exists corrections (
  id integer generated always as identity primary key,
  run_id integer not null references runs(id),
  actor_id integer not null references users(id),
  at timestamptz not null default now(),
  reason text not null,
  before jsonb not null,
  after jsonb not null
);
create or replace function corrections_are_immutable() returns trigger language plpgsql as $$
begin
  raise exception 'correction entries are never changed or deleted';
end $$;
drop trigger if exists corrections_frozen on corrections;
create trigger corrections_frozen before update or delete on corrections
  for each row execute function corrections_are_immutable();

create table if not exists protests (
  id integer generated always as identity primary key,
  event_id integer not null references events(id) on delete cascade,
  filed_by integer not null references users(id),
  subject_registration_id integer not null references registrations(id) on delete cascade,
  text text not null,
  filed_at timestamptz not null default now(),
  status text not null default 'pending',
  decision_note text,
  decided_by integer references users(id),
  decided_at timestamptz
);

create table if not exists publications (
  event_id integer primary key references events(id) on delete cascade,
  pdf_key text not null,
  checksum text not null
);

create table if not exists email_deliveries (
  id integer generated always as identity primary key,
  kind text not null,
  registration_id integer not null references registrations(id) on delete cascade,
  recipient text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create unique index if not exists deliveries_registration_key on email_deliveries (registration_id) where kind = 'registration';
create unique index if not exists deliveries_results_key on email_deliveries (registration_id) where kind = 'results';
create index if not exists deliveries_pending on email_deliveries (status) where status = 'pending';

create table if not exists idempotency_keys (
  user_id integer not null references users(id) on delete cascade,
  key text not null,
  fingerprint text not null,
  status integer not null,
  body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);
`;
