create extension if not exists pgcrypto;

create table if not exists clubs (
  code text primary key,
  name text not null,
  tier text not null,
  sort_index int not null
);

create table if not exists players (
  id text primary key,
  name text not null,
  club text not null references clubs(code),
  position text not null,
  price_tenths int not null
);

create table if not exists gameweeks (
  number int primary key,
  status text not null,
  deadline timestamptz,
  first_kickoff timestamptz,
  locked_at timestamptz,
  closed_at timestamptz
);

create table if not exists fixtures (
  id text primary key,
  gameweek int not null references gameweeks(number),
  home text not null references clubs(code),
  away text not null references clubs(code),
  kickoff timestamptz not null
);
create index if not exists fixtures_gameweek_idx on fixtures(gameweek);

create table if not exists managers (
  id uuid primary key default gen_random_uuid(),
  pb_user_id text unique not null,
  email text not null,
  team_name text not null,
  role text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  token text primary key,
  manager_id uuid not null references managers(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists squads (
  manager_id uuid primary key references managers(id) on delete cascade,
  bank_tenths int not null,
  created_at timestamptz not null default now()
);

create table if not exists squad_players (
  manager_id uuid not null references managers(id) on delete cascade,
  player_id text not null references players(id),
  purchase_price_tenths int not null,
  slot text not null,
  starting_index int,
  bench_order int,
  captain boolean not null default false,
  vice_captain boolean not null default false,
  primary key (manager_id, player_id)
);

create table if not exists manager_gameweeks (
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  free_transfers_at_start int not null,
  transfers_counted int not null default 0,
  primary key (manager_id, gameweek)
);

create table if not exists ledger_entries (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  manager_id uuid not null references managers(id) on delete cascade,
  kind text not null,
  amount_tenths int not null,
  player_id text,
  transfer_id uuid,
  reverses uuid,
  gameweek int,
  created_at timestamptz not null default now()
);
create index if not exists ledger_manager_idx on ledger_entries(manager_id, seq);

create table if not exists transfers (
  id uuid primary key default gen_random_uuid(),
  seq bigserial,
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  made_at timestamptz not null default now(),
  out_player text not null references players(id),
  in_player text not null references players(id),
  sell_price_tenths int not null,
  price_tenths int not null,
  free_hit boolean not null default false
);
create index if not exists transfers_manager_idx on transfers(manager_id, seq);

create table if not exists chips_played (
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  chip text not null,
  primary key (manager_id, gameweek)
);

create table if not exists drafts (
  manager_id uuid primary key references managers(id) on delete cascade,
  gameweek int not null,
  state text not null,
  out_ids jsonb not null default '[]'::jsonb,
  in_ids jsonb not null default '[]'::jsonb,
  refusal jsonb
);

create table if not exists idempotency_keys (
  manager_id uuid not null references managers(id) on delete cascade,
  key text not null,
  body_hash text not null,
  response_status int not null,
  response_body jsonb not null,
  created_at timestamptz not null default now(),
  primary key (manager_id, key)
);

create table if not exists locked_teams (
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  starting jsonb not null,
  bench jsonb not null,
  captain text not null,
  vice_captain text not null,
  chip text,
  bank_tenths int not null,
  locked_at timestamptz not null,
  receipt text not null default 'pending',
  snapshot_json text not null,
  primary key (manager_id, gameweek)
);

create table if not exists match_events (
  event_id text primary key,
  gameweek int not null,
  fixture_id text not null,
  player_id text not null references players(id),
  type text not null,
  value int,
  voided boolean not null default false,
  recorded_at timestamptz not null default now(),
  body_hash text not null,
  response_body jsonb not null
);
create index if not exists events_gameweek_idx on match_events(gameweek, recorded_at);

create table if not exists gameweek_scores (
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  points int not null,
  hit_points int not null,
  net_points int not null,
  running_total int not null,
  chip text,
  captain text,
  vice_captain text,
  transfers_made int not null,
  primary key (manager_id, gameweek)
);

create table if not exists leagues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,
  admin_manager_id uuid not null references managers(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists league_members (
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (league_id, manager_id)
);

create table if not exists league_ranks (
  league_id uuid not null references leagues(id) on delete cascade,
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  rank int not null,
  primary key (league_id, manager_id, gameweek)
);

create table if not exists price_runs (
  run_date date primary key,
  created_at timestamptz not null default now()
);

create table if not exists price_moves (
  id bigserial primary key,
  run_date date not null,
  player_id text not null references players(id),
  delta_tenths int not null,
  gameweek int not null,
  price_tenths int not null
);
create index if not exists price_moves_player_idx on price_moves(player_id, gameweek);

create table if not exists notices (
  id uuid primary key default gen_random_uuid(),
  manager_id uuid not null references managers(id) on delete cascade,
  kind text not null,
  gameweek int not null,
  message text not null,
  created_at timestamptz not null default now(),
  pb_id text,
  delivered boolean not null default false,
  dedupe_key text unique
);
create index if not exists notices_pending_idx on notices(delivered) where delivered = false;

create table if not exists free_hit_states (
  manager_id uuid not null references managers(id) on delete cascade,
  gameweek int not null,
  state jsonb not null,
  primary key (manager_id, gameweek)
);
