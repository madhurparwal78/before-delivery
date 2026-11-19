// Idempotent schema, applied on every serve.

import { Db } from "./db";

const SCHEMA = `
CREATE TABLE IF NOT EXISTS worlds (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  tick BIGINT NOT NULL DEFAULT 0,
  frozen BOOL NOT NULL DEFAULT FALSE,
  start_ms BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  name TEXT NOT NULL,
  handle TEXT NOT NULL,
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  confirmed BOOL NOT NULL DEFAULT FALSE,
  ranger BOOL NOT NULL DEFAULT FALSE,
  code TEXT,
  code_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_world_email ON players(world_id, lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS players_world_handle ON players(world_id, handle);
CREATE UNIQUE INDEX IF NOT EXISTS players_id_unique ON players(id);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS positions (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  island INT NOT NULL DEFAULT 1,
  x INT NOT NULL DEFAULT 3,
  y INT NOT NULL DEFAULT 12,
  heading TEXT NOT NULL DEFAULT 'E',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS film_ledger (
  id BIGSERIAL PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  change_id TEXT NOT NULL,
  account TEXT NOT NULL,
  amount INT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS film_ledger_player ON film_ledger(player_id, id);

CREATE TABLE IF NOT EXISTS stamps (
  player_id TEXT NOT NULL REFERENCES players(id),
  island INT NOT NULL,
  earned BOOL NOT NULL DEFAULT FALSE,
  PRIMARY KEY (player_id, island)
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  creature_id TEXT NOT NULL,
  island INT NOT NULL,
  tick BIGINT NOT NULL,
  tile_x INT NOT NULL,
  tile_y INT NOT NULL,
  heading TEXT NOT NULL,
  zoom INT NOT NULL,
  focus INT NOT NULL,
  size INT NOT NULL,
  centring INT NOT NULL,
  facing INT NOT NULL,
  sharpness INT NOT NULL,
  total INT NOT NULL,
  stored BOOL NOT NULL DEFAULT TRUE,
  content_type TEXT NOT NULL,
  bytes INT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS photos_player ON photos(player_id, created_at);

CREATE TABLE IF NOT EXISTS shot_keys (
  player_id TEXT NOT NULL REFERENCES players(id),
  shot_key TEXT NOT NULL,
  photo_id TEXT,
  pose TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, shot_key)
);
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'shot_keys' AND column_name = 'pose') THEN
    ALTER TABLE shot_keys ADD COLUMN pose TEXT;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS request_keys (
  player_id TEXT NOT NULL REFERENCES players(id),
  request_key TEXT NOT NULL,
  route TEXT NOT NULL,
  body TEXT NOT NULL,
  status INT NOT NULL,
  answer TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, request_key)
);

CREATE TABLE IF NOT EXISTS hall_frames (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  public BOOL NOT NULL DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS hall_photos (
  id BIGSERIAL PRIMARY KEY,
  player_id TEXT NOT NULL REFERENCES players(id),
  frame INT NOT NULL,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  caption TEXT NOT NULL DEFAULT '',
  UNIQUE (player_id, frame)
);

CREATE TABLE IF NOT EXISTS likes (
  photo_id TEXT NOT NULL REFERENCES photos(id),
  visitor_id TEXT NOT NULL REFERENCES players(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (photo_id, visitor_id)
);

CREATE TABLE IF NOT EXISTS safaris (
  code TEXT NOT NULL,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  status TEXT NOT NULL DEFAULT 'open',
  host_id TEXT NOT NULL REFERENCES players(id),
  guest_id TEXT,
  seat_freed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (world_id, code)
);

CREATE TABLE IF NOT EXISTS sightings (
  id BIGSERIAL PRIMARY KEY,
  safari_code TEXT NOT NULL,
  world_id TEXT NOT NULL,
  island INT NOT NULL,
  x INT NOT NULL,
  y INT NOT NULL,
  by_name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  author_id TEXT NOT NULL REFERENCES players(id),
  text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reason TEXT,
  decided_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS postcards (
  id TEXT PRIMARY KEY,
  sender_id TEXT NOT NULL REFERENCES players(id),
  photo_id TEXT NOT NULL REFERENCES photos(id),
  recipient TEXT NOT NULL,
  line TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'posted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS board_entries (
  id BIGSERIAL PRIMARY KEY,
  world_id TEXT NOT NULL REFERENCES worlds(id),
  island INT NOT NULL,
  player_id TEXT NOT NULL REFERENCES players(id),
  photo_id TEXT NOT NULL REFERENCES photos(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (world_id, island, player_id)
);

CREATE TABLE IF NOT EXISTS settings (
  player_id TEXT PRIMARY KEY REFERENCES players(id),
  music INT NOT NULL DEFAULT 60,
  effects INT NOT NULL DEFAULT 80,
  graphics TEXT NOT NULL DEFAULT 'full'
);

CREATE TABLE IF NOT EXISTS album_pages (
  player_id TEXT NOT NULL REFERENCES players(id),
  creature_id TEXT NOT NULL,
  photo_id TEXT NOT NULL REFERENCES photos(id),
  total INT NOT NULL,
  filled BOOL NOT NULL DEFAULT FALSE,
  tick BIGINT NOT NULL,
  PRIMARY KEY (player_id, creature_id)
);
`;

export async function migrate(db: Db): Promise<void> {
  await db.query(SCHEMA);
}
