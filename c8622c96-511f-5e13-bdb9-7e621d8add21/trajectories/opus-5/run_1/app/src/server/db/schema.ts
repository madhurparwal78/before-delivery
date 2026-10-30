export const SCHEMA_SQL = `
create table if not exists newsrooms (
  slug text primary key,
  name text not null,
  home_zone text not null
);

create table if not exists people (
  id text primary key,
  email text not null unique,
  name text not null,
  role text not null,
  newsroom_slug text references newsrooms(slug),
  contributor_handle text unique,
  payout_account text,
  password_hash text not null
);

create table if not exists sessions (
  id text primary key,
  person_id text not null references people(id),
  created_at timestamptz not null default now()
);

create table if not exists essays (
  id text primary key,
  title text not null,
  caption text not null,
  lift_local text not null,
  lift_at timestamptz not null,
  lift_resolution text not null,
  exclusive_days integer not null,
  standard_days integer not null,
  exclusive_price_minor integer not null,
  standard_price_minor integer not null,
  state text not null,
  version integer not null default 1,
  withdrawal_requested boolean not null default false,
  takedown_reference text,
  takedown_cleaned boolean not null default false,
  created_at timestamptz not null default now(),
  submitted_at timestamptz
);

create table if not exists essay_credits (
  essay_id text not null references essays(id) on delete cascade,
  position integer not null,
  contributor_handle text not null references people(contributor_handle),
  split_bp integer not null,
  primary key (essay_id, position),
  unique (essay_id, contributor_handle)
);

create table if not exists frames (
  id text primary key,
  essay_id text not null references essays(id) on delete cascade,
  position integer not null,
  caption text not null default '',
  filename text not null,
  bytes integer not null,
  content_type text not null,
  width integer not null,
  height integer not null,
  created_at timestamptz not null default now()
);

create table if not exists desk_notes (
  id text primary key,
  essay_id text not null references essays(id) on delete cascade,
  note text not null,
  at timestamptz not null
);

create table if not exists follows (
  id text primary key,
  person_id text not null references people(id),
  essay_id text references essays(id) on delete cascade,
  contributor_handle text references people(contributor_handle),
  created_at timestamptz not null
);

create unique index if not exists follows_person_essay
  on follows (person_id, essay_id) where essay_id is not null;
create unique index if not exists follows_person_contributor
  on follows (person_id, contributor_handle) where contributor_handle is not null;

create table if not exists shortlist_items (
  id text primary key,
  newsroom_slug text not null references newsrooms(slug),
  essay_id text not null references essays(id) on delete cascade,
  frame_id text not null references frames(id) on delete cascade,
  added_by text not null references people(id),
  added_at timestamptz not null,
  unique (newsroom_slug, frame_id)
);

create table if not exists licences (
  id text primary key,
  essay_id text not null references essays(id) on delete cascade,
  newsroom_slug text not null references newsrooms(slug),
  licensed_by text not null references people(id),
  kind text not null,
  state text not null,
  amount_minor integer not null,
  rate_bp integer not null,
  confirmed_at timestamptz not null,
  window_start timestamptz not null,
  window_end timestamptz not null,
  hold_until timestamptz not null,
  invoice_state text not null,
  grant_written boolean not null default false,
  charge_attempts integer not null default 0,
  activating_since timestamptz,
  next_attempt_at timestamptz,
  revoked_at timestamptz
);

create unique index if not exists licences_one_exclusive_per_essay
  on licences (essay_id)
  where kind = 'exclusive' and state in ('pending_invoice', 'active');

create unique index if not exists licences_one_per_newsroom_per_essay
  on licences (essay_id, newsroom_slug)
  where state in ('pending_invoice', 'active');

create table if not exists idempotency_records (
  person_id text not null references people(id),
  idempotency_key text not null,
  essay_id text not null,
  kind text not null,
  status_code integer,
  response jsonb,
  completed boolean not null default false,
  created_at timestamptz not null default now(),
  primary key (person_id, idempotency_key)
);

create table if not exists commission_rates (
  effective_from date primary key,
  rate_bp integer not null
);

create table if not exists royalty_statements (
  month text primary key,
  created_at timestamptz not null,
  invoiced_minor integer not null,
  commission_minor integer not null
);

create table if not exists statement_lines (
  month text not null references royalty_statements(month) on delete cascade,
  licence_id text not null,
  essay_title text not null,
  newsroom_slug text not null,
  newsroom_name text not null,
  confirmed_at timestamptz not null,
  amount_minor integer not null,
  rate_bp integer not null,
  commission_minor integer not null,
  primary key (month, licence_id)
);

create table if not exists statement_shares (
  month text not null references royalty_statements(month) on delete cascade,
  licence_id text not null,
  handle text not null,
  name text not null,
  position integer not null,
  split_bp integer not null,
  amount_minor integer not null,
  primary key (month, licence_id, handle)
);

create table if not exists payouts (
  month text not null references royalty_statements(month) on delete cascade,
  handle text not null,
  name text not null,
  amount_minor integer not null,
  state text not null,
  next_attempt_at timestamptz,
  primary key (month, handle)
);

create table if not exists outbound_mail (
  id text primary key,
  dedupe_key text not null unique,
  kind text not null,
  essay_id text references essays(id) on delete set null,
  licence_id text,
  to_email text not null,
  subject text not null,
  body text not null,
  state text not null,
  attempts integer not null default 0,
  next_attempt_at timestamptz not null,
  created_at timestamptz not null,
  sent_at timestamptz
);

create table if not exists clock_offset (
  only_row boolean primary key default true,
  offset_ms bigint not null
);
`;
