create table if not exists users (
  id text primary key,
  username text not null unique,
  password_hash text not null,
  created_at timestamptz not null default now()
);

create table if not exists sessions (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists tournaments (
  id text primary key,
  name text not null,
  format text not null,
  time_zone text not null,
  fill text not null,
  state text not null,
  organizer_id text not null references users(id) on delete cascade,
  share_code text not null unique,
  checkin_closes_at timestamptz,
  checkin_closed_at timestamptz,
  seeding_version integer not null default 0,
  seeding_by text,
  swiss_rounds integer,
  field_size integer,
  roster_key text,
  roster_file_name text,
  roster_sha256 text,
  logo_key text,
  logo_content_type text,
  logo_sha256 text,
  started_at timestamptz,
  finished_at timestamptz,
  finished_on text,
  last_seq integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists co_organizers (
  tournament_id text not null references tournaments(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  primary key (tournament_id, user_id)
);

create table if not exists entrants (
  id text primary key,
  tournament_id text not null references tournaments(id) on delete cascade,
  name text not null,
  seed integer not null,
  user_id text references users(id) on delete set null,
  checked_in boolean not null default false,
  placement integer
);

create index if not exists entrants_tournament_seed on entrants (tournament_id, seed);
create unique index if not exists entrants_one_account_per_tournament
  on entrants (tournament_id, user_id) where user_id is not null;

create table if not exists matches (
  id text primary key,
  tournament_id text not null references tournaments(id) on delete cascade,
  bracket text not null,
  round integer not null,
  number integer not null,
  label text not null,
  upper_entrant_id text references entrants(id) on delete set null,
  lower_entrant_id text references entrants(id) on delete set null,
  upper_bye boolean not null default false,
  lower_bye boolean not null default false,
  state text not null,
  upper_games integer,
  lower_games integer,
  winner text,
  report jsonb,
  dispute jsonb,
  called_at timestamptz,
  auto_confirm_at timestamptz,
  paired_at timestamptz,
  overdue boolean not null default false,
  version integer not null default 1,
  updated_by text,
  unique (tournament_id, bracket, round, number)
);

create index if not exists matches_tournament on matches (tournament_id);
create unique index if not exists matches_label on matches (tournament_id, label);

create table if not exists match_feeds (
  tournament_id text not null references tournaments(id) on delete cascade,
  src_match_id text not null references matches(id) on delete cascade,
  outcome text not null,
  dst_match_id text not null references matches(id) on delete cascade,
  slot text not null,
  primary key (src_match_id, outcome)
);

create index if not exists match_feeds_dst on match_feeds (dst_match_id);

create table if not exists live_messages (
  tournament_id text not null references tournaments(id) on delete cascade,
  seq integer not null,
  type text not null,
  audience text not null,
  data jsonb not null,
  at timestamptz not null,
  primary key (tournament_id, seq)
);

create table if not exists rate_events (
  id bigserial primary key,
  bucket text not null,
  at timestamptz not null
);

create index if not exists rate_events_bucket on rate_events (bucket, at);

create table if not exists history_rows (
  id text primary key,
  user_id text not null references users(id) on delete cascade,
  tournament_id text not null references tournaments(id) on delete cascade,
  tournament_name text not null,
  place integer not null,
  field_size integer not null,
  finished_on text not null,
  text text not null,
  finished_at timestamptz not null,
  unique (user_id, tournament_id)
);

create table if not exists edit_previews (
  token text primary key,
  match_id text not null references matches(id) on delete cascade,
  upper_games integer not null,
  lower_games integer not null,
  payload jsonb not null,
  created_at timestamptz not null default now()
);
