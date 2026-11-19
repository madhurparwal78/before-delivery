CREATE TABLE IF NOT EXISTS worlds (
  id text PRIMARY KEY,
  tick bigint NOT NULL DEFAULT 6000,
  frozen boolean NOT NULL DEFAULT false,
  base_tick bigint NOT NULL DEFAULT 6000,
  started_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id uuid PRIMARY KEY,
  world_id text NOT NULL REFERENCES worlds(id) ON DELETE CASCADE,
  name text NOT NULL,
  handle text NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  ranger boolean NOT NULL DEFAULT false,
  confirm_code text,
  confirm_expires_at timestamptz,
  island integer NOT NULL DEFAULT 1,
  tile_x integer NOT NULL DEFAULT 3,
  tile_y integer NOT NULL DEFAULT 12,
  heading text NOT NULL DEFAULT 'E',
  music integer NOT NULL DEFAULT 60,
  effects integer NOT NULL DEFAULT 80,
  graphics text NOT NULL DEFAULT 'full',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  world_id text NOT NULL,
  creature_id text NOT NULL,
  island integer NOT NULL,
  tick bigint NOT NULL,
  total integer NOT NULL,
  size integer NOT NULL,
  centring integer NOT NULL,
  facing integer NOT NULL,
  sharpness integer NOT NULL,
  measures jsonb NOT NULL,
  image_key text NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS album_pages (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  island integer NOT NULL,
  creature_id text NOT NULL,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  total integer NOT NULL,
  PRIMARY KEY (player_id, creature_id)
);

CREATE TABLE IF NOT EXISTS stamps (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  island integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, island)
);

CREATE TABLE IF NOT EXISTS film_ledger (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  change_id uuid NOT NULL,
  account text NOT NULL,
  amount integer NOT NULL,
  reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (change_id, account)
);

CREATE INDEX IF NOT EXISTS film_ledger_player ON film_ledger (player_id, account);

CREATE TABLE IF NOT EXISTS halls (
  player_id uuid PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
  public boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS hall_frames (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  frame integer NOT NULL,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  caption text NOT NULL DEFAULT '',
  PRIMARY KEY (player_id, frame)
);

CREATE TABLE IF NOT EXISTS likes (
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  visitor_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY,
  world_id text NOT NULL,
  author_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  text text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  reason text,
  decided_by uuid REFERENCES players(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS safaris (
  id uuid PRIMARY KEY,
  world_id text NOT NULL,
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'open',
  host_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES players(id) ON DELETE SET NULL,
  guest_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sightings (
  id uuid PRIMARY KEY,
  safari_id uuid NOT NULL REFERENCES safaris(id) ON DELETE CASCADE,
  island integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  by_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_entries (
  world_id text NOT NULL,
  island integer NOT NULL,
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, island, player_id)
);

CREATE TABLE IF NOT EXISTS postcards (
  id uuid PRIMARY KEY,
  sender_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  photo_id uuid NOT NULL REFERENCES photos(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  line text NOT NULL,
  status text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS request_keys (
  player_id uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  key text NOT NULL,
  scope text NOT NULL,
  fingerprint text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, scope, key)
);

CREATE TABLE IF NOT EXISTS events (
  id bigserial PRIMARY KEY,
  world_id text NOT NULL,
  audience uuid,
  kind text NOT NULL,
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS events_world ON events (world_id, id);
