export const SCHEMA_SQL = `
create table if not exists members (
  id uuid primary key,
  display_name text not null,
  email text not null unique,
  roles text[] not null,
  id_state text not null,
  photo_file_id uuid,
  created_at timestamptz not null
);

create table if not exists sign_in_codes (
  id uuid primary key,
  email text not null,
  code text not null,
  issued_at timestamptz not null,
  expires_at timestamptz not null,
  consumed_at timestamptz,
  superseded boolean not null default false
);
create index if not exists sign_in_codes_email_idx on sign_in_codes (email, issued_at desc);

create table if not exists sessions (
  token text primary key,
  member_id uuid not null references members (id),
  created_at timestamptz not null
);

create table if not exists vehicles (
  id uuid primary key,
  owner_id uuid not null references members (id),
  make_model text not null,
  colour text not null,
  seats integer not null,
  created_at timestamptz not null
);
create index if not exists vehicles_owner_idx on vehicles (owner_id, created_at);

create table if not exists rides (
  id uuid primary key,
  driver_id uuid not null references members (id),
  vehicle_id uuid not null references vehicles (id),
  booking_mode text not null,
  seats integer not null,
  price_cents integer not null,
  route_km integer not null,
  departure timestamptz not null,
  previous_departure timestamptz,
  free_cancel_until timestamptz,
  state text not null,
  version integer not null,
  created_at timestamptz not null
);
create index if not exists rides_state_departure_idx on rides (state, departure);

create table if not exists ride_stops (
  ride_id uuid not null references rides (id),
  idx integer not null,
  city text not null,
  km integer not null,
  primary key (ride_id, idx)
);

create table if not exists bookings (
  id uuid primary key,
  ride_id uuid not null references rides (id),
  passenger_id uuid not null references members (id),
  boarding_idx integer not null,
  alighting_idx integer not null,
  seats integer not null,
  seat_numbers integer[] not null,
  segment_km integer not null,
  price_cents integer not null,
  state text not null,
  created_at timestamptz not null,
  hold_expires_at timestamptz,
  request_deadline timestamptz,
  ended_at timestamptz,
  rating_closes_at timestamptz,
  revealed_at timestamptz
);
create index if not exists bookings_ride_idx on bookings (ride_id);
create index if not exists bookings_passenger_idx on bookings (passenger_id, created_at desc);
create index if not exists bookings_state_idx on bookings (state);

create table if not exists booking_history (
  id bigserial primary key,
  booking_id uuid not null references bookings (id),
  state text not null,
  at timestamptz not null
);
create index if not exists booking_history_booking_idx on booking_history (booking_id, id);

create table if not exists ledger_entries (
  id uuid primary key,
  kind text not null,
  at timestamptz not null,
  booking_id uuid,
  seq bigserial
);
create index if not exists ledger_entries_booking_idx on ledger_entries (booking_id);

create table if not exists ledger_lines (
  id uuid primary key,
  entry_id uuid not null references ledger_entries (id),
  account text not null,
  amount_cents integer not null,
  wallet_member_id uuid,
  earnings_member_id uuid,
  label text,
  seq integer not null
);
create index if not exists ledger_lines_entry_idx on ledger_lines (entry_id, seq);
create index if not exists ledger_lines_wallet_idx on ledger_lines (wallet_member_id);
create index if not exists ledger_lines_earnings_idx on ledger_lines (earnings_member_id);

create table if not exists messages (
  id uuid primary key,
  booking_id uuid not null references bookings (id),
  author_id uuid not null references members (id),
  body text not null,
  sent_at timestamptz not null,
  seq bigserial
);
create index if not exists messages_booking_idx on messages (booking_id, seq);
create index if not exists messages_author_time_idx on messages (author_id, sent_at desc);

create table if not exists ratings (
  id uuid primary key,
  booking_id uuid not null references bookings (id),
  rater_id uuid not null references members (id),
  subject_id uuid not null references members (id),
  stars integer not null,
  comment text not null default '',
  submitted_at timestamptz not null,
  unique (booking_id, rater_id)
);
create index if not exists ratings_subject_idx on ratings (subject_id);

create table if not exists id_documents (
  id uuid primary key,
  member_id uuid not null references members (id),
  file_id uuid not null,
  uploaded_at timestamptz not null,
  state text not null,
  reason text,
  decided_at timestamptz
);
create index if not exists id_documents_state_idx on id_documents (state, uploaded_at);

create table if not exists files (
  id uuid primary key,
  member_id uuid not null references members (id),
  kind text not null,
  object_key text not null,
  content_type text not null,
  size_bytes integer not null,
  created_at timestamptz not null
);

create table if not exists outbox (
  id uuid primary key,
  kind text not null,
  to_email text not null,
  subject text not null,
  body text not null,
  status text not null,
  attempts integer not null default 0,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null,
  ride_id uuid,
  passenger_id uuid,
  member_id uuid,
  booking_id uuid,
  seq bigserial
);
create index if not exists outbox_status_idx on outbox (status, seq);
create index if not exists outbox_ride_idx on outbox (ride_id, seq);

create table if not exists idempotency_keys (
  member_id uuid not null,
  route text not null,
  key text not null,
  body_hash text not null,
  status integer not null,
  response jsonb not null,
  created_at timestamptz not null,
  primary key (member_id, route, key)
);

create table if not exists clock_offset (
  id integer primary key,
  offset_seconds bigint not null
);
insert into clock_offset (id, offset_seconds) values (1, 0) on conflict (id) do nothing;

create table if not exists seed_marker (
  id integer primary key,
  done_at timestamptz not null
);
`;
