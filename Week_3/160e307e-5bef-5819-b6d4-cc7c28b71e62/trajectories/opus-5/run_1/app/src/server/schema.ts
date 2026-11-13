export const SCHEMA_SQL = `
create table if not exists players (
  id uuid primary key,
  name text not null,
  name_lower text not null unique,
  avatar integer not null default 1,
  chosen boolean not null default false,
  email text unique,
  rating double precision not null default 1500,
  rd double precision not null default 350,
  volatility double precision not null default 0.06,
  ranked_games integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  player_id uuid not null references players(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists link_tokens (
  token text primary key,
  player_id uuid not null references players(id) on delete cascade,
  email text not null,
  used boolean not null default false,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists matches (
  id uuid primary key,
  mode text not null,
  format text not null,
  status text not null,
  room_code text,
  state jsonb not null,
  winner_seat integer,
  end_reason text,
  created_at timestamptz not null default now(),
  ended_at timestamptz
);

create table if not exists match_players (
  match_id uuid not null references matches(id) on delete cascade,
  seat integer not null,
  player_id uuid references players(id) on delete set null,
  name text not null,
  opponent_name text not null,
  score integer not null default 0,
  opponent_score integer not null default 0,
  rating_delta double precision,
  rating_after double precision,
  primary key (match_id, seat)
);

create table if not exists shots (
  match_id uuid not null references matches(id) on delete cascade,
  shot_seq integer not null,
  seat integer not null,
  events jsonb not null,
  verdict jsonb not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key (match_id, shot_seq)
);

create table if not exists rooms (
  code text primary key,
  format text not null,
  host_id uuid not null references players(id) on delete cascade,
  guest_id uuid references players(id) on delete set null,
  status text not null,
  match_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists queue_entries (
  player_id uuid primary key references players(id) on delete cascade,
  mode text not null,
  near integer not null,
  entered_at timestamptz not null default now(),
  match_id uuid
);

create table if not exists ledger_entries (
  id bigserial primary key,
  movement_id uuid not null,
  player_id uuid references players(id) on delete cascade,
  account text not null,
  delta integer not null,
  reason text not null,
  item_id text,
  created_at timestamptz not null default now()
);

create table if not exists owned_items (
  player_id uuid not null references players(id) on delete cascade,
  item_id text not null,
  primary key (player_id, item_id)
);

create table if not exists equipped_items (
  player_id uuid primary key references players(id) on delete cascade,
  striker text not null default 'striker-ply',
  board text not null default 'board-ply',
  coins text not null default 'coins-ivory'
);

create table if not exists idempotency_keys (
  scope text not null,
  key text not null,
  player_id uuid not null references players(id) on delete cascade,
  fingerprint text not null,
  response jsonb not null,
  created_at timestamptz not null default now(),
  primary key (scope, key)
);

create table if not exists match_awards (
  match_id uuid not null,
  player_id uuid not null references players(id) on delete cascade,
  reason text not null,
  primary key (match_id, player_id, reason)
);

create index if not exists match_players_player_idx on match_players (player_id);
create index if not exists ledger_player_idx on ledger_entries (player_id, id);
create index if not exists matches_room_idx on matches (room_code);
create index if not exists players_rating_idx on players (rating desc);
`;
