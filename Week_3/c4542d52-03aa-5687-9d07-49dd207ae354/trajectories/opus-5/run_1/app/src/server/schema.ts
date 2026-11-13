export const SCHEMA_SQL = `
create table if not exists people (
  id text primary key,
  name text not null,
  first_name text not null,
  email text not null unique,
  role text not null,
  access text not null,
  password_hash text,
  terminated_at timestamptz,
  termination_date date,
  window_ends_at timestamptz,
  warnings_at timestamptz[] not null default '{}',
  warnings_sent int not null default 0,
  window_closed boolean not null default false,
  seq bigserial
);

create table if not exists sessions (
  token text primary key,
  person_id text not null references people(id),
  created_at timestamptz not null default now()
);

create table if not exists holdings (
  person_id text not null references people(id),
  share_class text not null,
  shares bigint not null,
  primary key (person_id, share_class)
);

create table if not exists grants (
  id text primary key,
  holder_id text references people(id),
  options int,
  strike numeric(18,4),
  vesting_type text,
  vesting_start date,
  state text not null,
  draft_version int not null default 1,
  offered_at timestamptz,
  offer_expires_at timestamptz,
  offer_warning_at timestamptz,
  warning_sent boolean not null default false,
  accepted_at timestamptz,
  agreement_status text not null default 'none',
  agreement_document_id text,
  exercised int not null default 0,
  cancelled int not null default 0,
  forfeited int not null default 0,
  created_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists grant_votes (
  grant_id text not null references grants(id) on delete cascade,
  person_id text not null references people(id),
  vote text not null,
  at timestamptz not null default now(),
  primary key (grant_id, person_id)
);

create table if not exists valuations (
  id text primary key,
  effective_on date not null,
  expires_on date not null,
  fmv_per_share numeric(18,4) not null,
  firm text not null,
  recorded_at timestamptz not null default now(),
  seq bigserial
);

create table if not exists option_pool (
  id int primary key,
  authorized int not null
);

create table if not exists exercise_orders (
  id text primary key,
  grant_id text not null references grants(id),
  holder_id text not null references people(id),
  options int not null,
  strike numeric(18,4) not null,
  cost_cents bigint not null,
  idempotency_key text not null unique,
  state text not null,
  placed_at timestamptz not null,
  issued_at timestamptz,
  payment_id text,
  payment_status text,
  payment_amount_cents bigint,
  payment_currency text,
  payment_reference text,
  payment_confirmed_at timestamptz,
  notice_document_id text,
  request_options int not null,
  response_status int,
  response_body jsonb,
  seq bigserial
);

create table if not exists documents (
  id text primary key,
  kind text not null,
  title text not null,
  owner_id text not null references people(id),
  status text not null,
  sha256 text,
  vault_key text not null,
  body text not null,
  created_at timestamptz not null default now(),
  version int not null default 1,
  supersedes text,
  superseded_by text,
  grant_id text,
  order_id text,
  tender_id text
);

create table if not exists tenders (
  id text primary key,
  title text not null,
  buyer text not null,
  price_per_share numeric(18,4) not null,
  share_cap int not null,
  closes_at timestamptz not null,
  state text not null,
  created_at timestamptz not null default now()
);

create table if not exists tender_ndas (
  tender_id text not null references tenders(id),
  person_id text not null references people(id),
  status text not null,
  document_id text,
  primary key (tender_id, person_id)
);

create table if not exists tender_drafts (
  tender_id text not null references tenders(id),
  person_id text not null references people(id),
  shares text,
  primary key (tender_id, person_id)
);

create table if not exists tender_submissions (
  tender_id text not null references tenders(id),
  person_id text not null references people(id),
  shares int not null,
  submitted_at timestamptz not null,
  sequence int not null,
  allocation int,
  proceeds_cents bigint,
  primary key (tender_id, person_id)
);

create table if not exists ledger_entries (
  id text primary key,
  at timestamptz not null,
  holder_id text references people(id),
  kind text not null,
  share_class text,
  shares_delta bigint not null default 0,
  options_delta bigint not null default 0,
  reference text,
  seq bigserial
);

create table if not exists live_events (
  seq bigserial primary key,
  at timestamptz not null default now(),
  type text not null,
  data jsonb not null,
  audience jsonb not null
);

create table if not exists saved_scenarios (
  id text primary key,
  name text not null,
  pre_money text not null,
  investment text not null,
  target_pool_percent text not null,
  saved_at timestamptz not null default now()
);

create unique index if not exists saved_scenarios_name_key on saved_scenarios (lower(name));

create table if not exists register_state (
  key text primary key,
  value text not null
);

create sequence if not exists grant_number start 12;
create sequence if not exists order_number start 1;
create sequence if not exists tender_number start 1;
create sequence if not exists document_number start 1;
create sequence if not exists ledger_number start 1;
create sequence if not exists person_number start 12;
create sequence if not exists valuation_number start 3;
create sequence if not exists scenario_number start 1;
`;
