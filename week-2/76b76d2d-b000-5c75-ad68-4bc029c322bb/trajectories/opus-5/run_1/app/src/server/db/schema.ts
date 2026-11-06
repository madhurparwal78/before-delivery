export const SCHEMA_SQL = `
create or replace function seat_sort(seat text) returns text as $$
  select regexp_replace(seat, '[0-9]', '', 'g') || lpad(regexp_replace(seat, '[^0-9]', '', 'g'), 4, '0')
$$ language sql immutable;

create table if not exists venues (
  id serial primary key,
  name text not null,
  address text not null
);

create table if not exists auditoriums (
  code text primary key,
  name text not null,
  venue_id integer not null references venues(id),
  row_letters text not null,
  seats_per_row integer not null,
  capacity integer not null
);

create table if not exists seasons (
  slug text primary key,
  title_en text not null,
  title_fr text not null,
  public_sale_date date not null,
  stored_state text not null,
  created_at timestamptz not null default now(),
  withdrawn_reason text
);

create table if not exists screenings (
  id text primary key,
  season_slug text not null references seasons(slug),
  sequence integer not null,
  film_title text not null,
  film_notes_en text not null default '',
  film_notes_fr text not null default '',
  format text not null,
  auditorium_code text not null references auditoriums(code),
  starts_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists screenings_season on screenings(season_slug);

create table if not exists accounts (
  id serial primary key,
  number text unique,
  name text not null,
  email text not null unique,
  password_hash text not null,
  role text not null,
  locale text not null,
  kb_account_id text,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  account_id integer not null references accounts(id),
  created_at timestamptz not null default now()
);

create table if not exists memberships (
  id serial primary key,
  account_id integer not null references accounts(id),
  tier text not null,
  cadence text not null,
  plan text not null,
  state text not null,
  kb_subscription_id text not null,
  started_on date not null,
  charged_through date,
  ends_on date,
  pending_tier text,
  pending_cadence text,
  pending_effective_date date,
  created_at timestamptz not null default now()
);
create index if not exists memberships_account on memberships(account_id, state);

create table if not exists membership_invoices (
  id serial primary key,
  account_id integer not null references accounts(id),
  kb_invoice_id text unique not null,
  amount_cents integer not null,
  credit_applied_cents integer not null,
  created_at timestamptz not null default now()
);

create table if not exists holds (
  id uuid primary key,
  screening_id text not null references screenings(id),
  account_id integer references accounts(id),
  guest_key text,
  is_group boolean not null default false,
  state text not null,
  ended_by text,
  created_at timestamptz not null,
  expires_at timestamptz not null,
  booking_id integer,
  last_quote_total_cents integer
);

create table if not exists hold_seats (
  hold_id uuid not null references holds(id) on delete cascade,
  seat text not null,
  primary key (hold_id, seat)
);

create table if not exists seat_claims (
  screening_id text not null references screenings(id),
  seat text not null,
  hold_id uuid,
  booking_id integer,
  sold boolean not null default false,
  expires_at timestamptz,
  primary key (screening_id, seat)
);

create table if not exists bookings (
  id serial primary key,
  ref text unique not null,
  screening_id text not null references screenings(id),
  account_id integer references accounts(id),
  hold_id uuid,
  state text not null,
  locale text not null,
  is_group boolean not null default false,
  name text not null,
  email text not null,
  phone text,
  note text not null default '',
  cardholder_name text not null,
  admission_cents integer not null,
  gst_cents integer not null,
  qst_cents integer not null,
  uplift_cents integer not null,
  total_cents integer not null,
  credit_applied_cents integer not null,
  paid_cents integer not null,
  kb_invoice_id text,
  kb_payment_id text,
  paid_at timestamptz,
  refunded_at timestamptz,
  refunded_cents integer,
  recredited_cents integer,
  guest_token text,
  guest_token_seq integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bookings_account on bookings(account_id);
create index if not exists bookings_paid_at on bookings(paid_at);

create table if not exists booking_lines (
  booking_id integer not null references bookings(id),
  position integer not null,
  fare text not null,
  quantity integer not null,
  unit_cents integer not null,
  subtotal_cents integer not null,
  gst_cents integer not null,
  qst_cents integer not null,
  primary key (booking_id, position)
);

create table if not exists booking_payers (
  booking_id integer not null references bookings(id),
  position integer not null,
  name text not null,
  seats integer not null,
  share_cents integer not null,
  primary key (booking_id, position)
);

create table if not exists tickets (
  code text primary key,
  booking_id integer not null references bookings(id),
  screening_id text not null references screenings(id),
  seat text not null,
  fare text not null,
  status text not null,
  checked_in_at timestamptz
);
create index if not exists tickets_booking on tickets(booking_id);
create index if not exists tickets_screening on tickets(screening_id);

create table if not exists gifts (
  id serial primary key,
  ref text unique not null,
  tier text not null,
  price_cents integer not null,
  purchaser_account_id integer references accounts(id),
  purchaser_name text not null,
  purchaser_email text not null,
  recipient_name text not null,
  recipient_email text not null,
  recipient_locale text not null,
  locale text not null,
  message text not null default '',
  cardholder_name text not null,
  state text not null,
  token text unique,
  credit_applied_cents integer not null default 0,
  paid_cents integer not null default 0,
  kb_invoice_id text,
  kb_payment_id text,
  redeemed_at timestamptz,
  redeemed_by integer references accounts(id),
  created_at timestamptz not null default now()
);

create table if not exists credit_ledger (
  id serial primary key,
  movement_id uuid not null,
  account_number text not null,
  ledger_account text not null,
  amount_cents integer not null,
  kind text not null,
  reference text not null,
  created_at timestamptz not null default now()
);
create index if not exists credit_ledger_account on credit_ledger(account_number);

create table if not exists audit_log (
  id serial primary key,
  at timestamptz not null default now(),
  actor text not null,
  action text not null,
  target text not null,
  amount_cents integer,
  reason text
);

create table if not exists idempotency_keys (
  key text primary key,
  caller text not null,
  endpoint text not null,
  body_hash text not null,
  state text not null,
  status integer,
  response jsonb,
  created_at timestamptz not null default now()
);

create table if not exists stepup_challenges (
  id uuid primary key,
  account_id integer not null references accounts(id),
  purpose text not null,
  code text not null,
  expires_at timestamptz not null,
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  email_seq integer not null
);

create table if not exists stepup_sends (
  id serial primary key,
  account_id integer not null references accounts(id),
  sent_at timestamptz not null default now()
);

create table if not exists stepup_lockouts (
  account_id integer primary key references accounts(id),
  locked_until timestamptz not null
);

create table if not exists stepup_verifications (
  session_token text primary key,
  account_id integer not null references accounts(id),
  valid_until timestamptz not null
);

create table if not exists outbox (
  seq serial primary key,
  message_key text unique not null,
  instance_port integer not null,
  kind text not null,
  recipient text not null,
  subject text not null,
  body text not null,
  locale text not null,
  state text not null,
  attempt_count integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  enqueued_at timestamptz not null default now()
);

create table if not exists outbox_attempts (
  id serial primary key,
  outbox_seq integer not null references outbox(seq),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  outcome text not null
);

create table if not exists enquiries (
  id serial primary key,
  ref text unique not null,
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  locale text not null,
  state text not null,
  reply_seq integer not null default 0,
  received_at timestamptz not null default now()
);

create table if not exists reconciliation_acceptances (
  business_day date primary key,
  difference_cents integer not null,
  reason text not null,
  accepted_at timestamptz not null default now()
);

create table if not exists kb_accounts (
  external_key text primary key,
  kb_account_id text not null,
  name text not null,
  email text not null,
  created_at timestamptz not null default now()
);

create table if not exists counters (
  name text primary key,
  value integer not null
);

create or replace function audit_log_append_only() returns trigger as $$
begin
  raise exception 'audit_log is append-only';
end;
$$ language plpgsql;

drop trigger if exists audit_log_no_update on audit_log;
create trigger audit_log_no_update before update on audit_log
  for each row execute function audit_log_append_only();

drop trigger if exists audit_log_no_delete on audit_log;
create trigger audit_log_no_delete before delete on audit_log
  for each row execute function audit_log_append_only();

create or replace function credit_ledger_append_only() returns trigger as $$
begin
  raise exception 'credit_ledger is append-only';
end;
$$ language plpgsql;

drop trigger if exists credit_ledger_no_update on credit_ledger;
create trigger credit_ledger_no_update before update on credit_ledger
  for each row execute function credit_ledger_append_only();

drop trigger if exists credit_ledger_no_delete on credit_ledger;
create trigger credit_ledger_no_delete before delete on credit_ledger
  for each row execute function credit_ledger_append_only();
`;
