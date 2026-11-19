/** The schema, applied idempotently on every serve. Ids are uuid strings held as text. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  kind text NOT NULL,
  frozen boolean NOT NULL,
  tick integer NOT NULL,
  anchor_tick integer NOT NULL DEFAULT 0,
  anchor_ms bigint NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS players (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  world_id text NOT NULL REFERENCES worlds(id),
  name text NOT NULL,
  handle text NOT NULL UNIQUE,
  email text NOT NULL,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  ranger boolean NOT NULL DEFAULT false,
  confirm_code text,
  confirm_code_expires timestamptz,
  island integer NOT NULL DEFAULT 1,
  tile_x integer NOT NULL DEFAULT 3,
  tile_y integer NOT NULL DEFAULT 12,
  heading text NOT NULL DEFAULT 'E',
  music integer NOT NULL DEFAULT 60,
  effects integer NOT NULL DEFAULT 80,
  graphics text NOT NULL DEFAULT 'full',
  hall_public boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_email ON players (lower(email));

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  creature_id text NOT NULL,
  island integer NOT NULL,
  tick integer NOT NULL,
  size integer NOT NULL,
  centring integer NOT NULL,
  facing integer NOT NULL,
  sharpness integer NOT NULL,
  total integer NOT NULL,
  measures jsonb,
  pose jsonb,
  shot_key text,
  answer jsonb,
  image_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_player ON photos (player_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS photos_shot_key ON photos (player_id, shot_key) WHERE shot_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS film_ledger (
  player_id text NOT NULL REFERENCES players(id),
  change_id text NOT NULL,
  account text NOT NULL CHECK (account IN ('satchel', 'locker')),
  amount integer NOT NULL,
  reason text NOT NULL CHECK (reason IN ('start', 'photo', 'page', 'refill', 'restart')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS film_ledger_player ON film_ledger (player_id, account);

CREATE TABLE IF NOT EXISTS album_pages (
  player_id text NOT NULL REFERENCES players(id),
  creature_id text NOT NULL,
  photo_id text NOT NULL REFERENCES photos(id),
  PRIMARY KEY (player_id, creature_id)
);

CREATE TABLE IF NOT EXISTS stamps (
  player_id text NOT NULL REFERENCES players(id),
  island integer NOT NULL,
  PRIMARY KEY (player_id, island)
);

CREATE TABLE IF NOT EXISTS hall_frames (
  player_id text NOT NULL REFERENCES players(id),
  photo_id text NOT NULL REFERENCES photos(id),
  frame integer NOT NULL,
  caption text NOT NULL DEFAULT '',
  PRIMARY KEY (player_id, photo_id)
);

CREATE TABLE IF NOT EXISTS likes (
  photo_id text NOT NULL REFERENCES photos(id),
  visitor_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS safaris (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  world_id text NOT NULL REFERENCES worlds(id),
  code text NOT NULL,
  host_id text NOT NULL REFERENCES players(id),
  guest_id text REFERENCES players(id),
  status text NOT NULL DEFAULT 'open',
  guest_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (world_id, code)
);
CREATE UNIQUE INDEX IF NOT EXISTS safaris_one_running_per_host ON safaris (host_id) WHERE status <> 'ended';

CREATE TABLE IF NOT EXISTS sightings (
  id bigserial PRIMARY KEY,
  safari_id text NOT NULL REFERENCES safaris(id),
  island integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  by_id text NOT NULL REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safari_photos (
  safari_id text NOT NULL REFERENCES safaris(id),
  photo_id text NOT NULL REFERENCES photos(id),
  PRIMARY KEY (safari_id, photo_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id text PRIMARY KEY DEFAULT gen_random_uuid()::text,
  world_id text NOT NULL REFERENCES worlds(id),
  author_id text NOT NULL REFERENCES players(id),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  decided_by text REFERENCES players(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_entries (
  island integer NOT NULL,
  player_id text NOT NULL REFERENCES players(id),
  photo_id text NOT NULL REFERENCES photos(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (island, player_id)
);

CREATE TABLE IF NOT EXISTS postcards (
  id text PRIMARY KEY,
  player_id text NOT NULL REFERENCES players(id),
  photo_id text NOT NULL REFERENCES photos(id),
  recipient text NOT NULL,
  line text NOT NULL,
  status text NOT NULL DEFAULT 'posted',
  posted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS postcards_sender ON postcards (player_id, posted_at);

CREATE TABLE IF NOT EXISTS request_keys (
  player_id text NOT NULL REFERENCES players(id),
  kind text NOT NULL,
  key text NOT NULL,
  body_hash text NOT NULL,
  status integer NOT NULL,
  response jsonb NOT NULL,
  PRIMARY KEY (player_id, kind, key)
);
`
