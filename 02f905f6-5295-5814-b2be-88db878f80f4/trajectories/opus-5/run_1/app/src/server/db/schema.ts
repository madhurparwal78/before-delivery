export const SCHEMA_SQL = `
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null unique,
  role text not null check (role in ('owner', 'tech', 'member')),
  member_number text unique,
  password_hash text not null,
  kb_account_id text,
  sort integer not null default 0
);

create table if not exists sessions (
  id text primary key,
  user_id uuid not null references users(id),
  created_at timestamptz not null default now()
);

create table if not exists clays (
  id text primary key,
  name text not null,
  max_cone text not null,
  sort integer not null default 0
);

create table if not exists kilns (
  id text primary key,
  name text not null,
  shelf_diameter_in numeric(4, 1) not null,
  layers integer not null,
  post_height_in numeric(4, 1) not null,
  usable_cubic_inches integer not null,
  sort integer not null default 0
);

create table if not exists kiln_profiles (
  id text primary key,
  kiln_id text not null references kilns(id),
  name text not null,
  stage text not null check (stage in ('bisque', 'glaze')),
  cone text not null,
  segments jsonb not null,
  cool_down_hours integer not null,
  sort integer not null default 0
);

create table if not exists rate_sets (
  id serial primary key,
  bisque_rate numeric(8, 4) not null,
  glaze_rate numeric(8, 4) not null,
  member_discount_percent integer not null,
  order_minimum_cents integer not null,
  effective_date date not null unique,
  created_at timestamptz not null default now()
);

create table if not exists photos (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid not null references users(id),
  content_type text not null,
  bytes integer not null,
  sha256 text not null,
  attached boolean not null default false,
  created_at timestamptz not null default now()
);

create sequence if not exists piece_number_seq start with 401;

create table if not exists firings (
  id uuid primary key default gen_random_uuid(),
  kiln_id text not null references kilns(id),
  profile jsonb not null,
  started_at timestamptz,
  firing_ends_at timestamptz,
  cool_until timestamptz,
  unloaded_at timestamptz,
  pickup_shelf text,
  created_at timestamptz not null default now()
);

create unique index if not exists firings_one_open_per_kiln
  on firings (kiln_id) where unloaded_at is null;

create table if not exists pieces (
  number text primary key,
  owner_kind text not null check (owner_kind in ('member', 'guest')),
  owner_user_id uuid references users(id),
  guest_name text,
  guest_email text,
  kb_account_id text,
  shape text not null check (shape in ('round', 'rectangular', 'plate')),
  width_half integer not null,
  depth_half integer not null,
  height_half integer not null,
  cubic_milli integer not null,
  fee_cents integer not null,
  rate_set_id integer not null references rate_sets(id),
  plan text not null,
  stage text,
  cone text,
  clay_id text not null references clays(id),
  status text not null,
  pickup_shelf text,
  intake_photo_id uuid references photos(id),
  invoice_id text,
  payment_status text,
  accepted_at timestamptz not null default now(),
  ready_at timestamptz,
  reminder_sent_at timestamptz
);

create table if not exists piece_history (
  id bigserial primary key,
  piece_number text not null references pieces(number),
  at timestamptz not null default now(),
  actor text not null,
  action text not null
);

create table if not exists placements (
  firing_id uuid not null references firings(id),
  piece_number text not null references pieces(number),
  layer integer not null,
  x_half integer not null,
  y_half integer not null,
  rotation integer not null,
  placed_at timestamptz not null default now(),
  primary key (firing_id, piece_number)
);

create table if not exists damage_reports (
  id uuid primary key default gen_random_uuid(),
  piece_number text not null references pieces(number),
  firing_id uuid not null references firings(id),
  kind text not null check (kind in ('glaze_run', 'crack')),
  note text not null default '',
  status text not null default 'reported' check (status in ('reported', 'charged', 'waived')),
  unload_photo_id uuid references photos(id),
  amount_cents integer,
  reported_by text not null,
  reported_at timestamptz not null default now(),
  settled_at timestamptz
);

create table if not exists tracking_links (
  token text primary key,
  piece_number text not null references pieces(number),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists tracking_links_one_live_per_piece
  on tracking_links (piece_number) where active;

create table if not exists idempotency_keys (
  user_id uuid not null references users(id),
  key text not null,
  body_hash text not null,
  state text not null check (state in ('running', 'done')),
  status integer,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (user_id, key)
);

create table if not exists outbox (
  id bigserial primary key,
  to_email text not null,
  subject text not null,
  body text not null,
  created_at timestamptz not null default now(),
  attempts integer not null default 0,
  sent_at timestamptz
);
`;
