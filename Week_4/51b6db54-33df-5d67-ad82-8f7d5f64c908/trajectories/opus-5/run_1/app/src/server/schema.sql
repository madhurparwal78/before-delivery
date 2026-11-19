CREATE TABLE IF NOT EXISTS clock (
  id integer PRIMARY KEY DEFAULT 1,
  base_business timestamptz NOT NULL,
  base_real timestamptz NOT NULL,
  CONSTRAINT clock_single CHECK (id = 1)
);

CREATE TABLE IF NOT EXISTS users (
  id serial PRIMARY KEY,
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  password_salt text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  code text,
  number_format text NOT NULL DEFAULT 'en-US',
  time_zone text NOT NULL DEFAULT 'UTC',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS projects (
  id serial PRIMARY KEY,
  name text NOT NULL,
  owner_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS memberships (
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL,
  token text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS palettes (
  id serial PRIMARY KEY,
  swatch_order integer[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS swatches (
  palette_id integer NOT NULL REFERENCES palettes(id) ON DELETE CASCADE,
  index integer NOT NULL,
  color text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  present boolean NOT NULL DEFAULT true,
  edited_by integer REFERENCES users(id) ON DELETE SET NULL,
  removed_by integer REFERENCES users(id) ON DELETE SET NULL,
  PRIMARY KEY (palette_id, index)
);

CREATE TABLE IF NOT EXISTS sprites (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  palette_id integer NOT NULL REFERENCES palettes(id) ON DELETE CASCADE,
  name text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS layers (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  name text NOT NULL,
  opacity integer NOT NULL DEFAULT 100,
  blend text NOT NULL DEFAULT 'normal',
  visible boolean NOT NULL DEFAULT true,
  locked_by integer REFERENCES users(id) ON DELETE SET NULL,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS frames (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  number integer NOT NULL,
  duration_ms integer NOT NULL
);

CREATE TABLE IF NOT EXISTS buffers (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  data bytea NOT NULL
);

CREATE TABLE IF NOT EXISTS cels (
  frame_id integer NOT NULL REFERENCES frames(id) ON DELETE CASCADE,
  layer_id integer NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  buffer_id integer NOT NULL REFERENCES buffers(id) ON DELETE CASCADE,
  PRIMARY KEY (frame_id, layer_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  name text NOT NULL,
  from_frame integer NOT NULL,
  to_frame integer NOT NULL,
  direction text NOT NULL,
  repeat integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS tilesets (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  name text NOT NULL,
  tile_size integer NOT NULL,
  edge_table integer[] NOT NULL
);

CREATE TABLE IF NOT EXISTS tiles (
  id serial PRIMARY KEY,
  tileset_id integer NOT NULL REFERENCES tilesets(id) ON DELETE CASCADE,
  number integer NOT NULL,
  data bytea NOT NULL
);

CREATE TABLE IF NOT EXISTS tilemaps (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  tileset_id integer NOT NULL REFERENCES tilesets(id) ON DELETE CASCADE,
  name text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL
);

CREATE TABLE IF NOT EXISTS tilemap_cells (
  tilemap_id integer NOT NULL REFERENCES tilemaps(id) ON DELETE CASCADE,
  x integer NOT NULL,
  y integer NOT NULL,
  tile integer NOT NULL,
  flip_h boolean NOT NULL DEFAULT false,
  flip_v boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tilemap_id, x, y)
);

CREATE TABLE IF NOT EXISTS operations (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  type text NOT NULL,
  by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  by_name text NOT NULL,
  at timestamptz NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  patch jsonb,
  undoable boolean NOT NULL DEFAULT false,
  stack_state text NOT NULL DEFAULT 'none',
  client_stroke_id text,
  response jsonb,
  UNIQUE (sprite_id, seq)
);

CREATE INDEX IF NOT EXISTS operations_replay
  ON operations (sprite_id, by_user_id, client_stroke_id);

CREATE TABLE IF NOT EXISTS comments (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  author_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  frame integer NOT NULL,
  x integer NOT NULL,
  y integer NOT NULL,
  text text NOT NULL,
  state text NOT NULL DEFAULT 'open',
  idempotency_key text,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS comment_mentions (
  id serial PRIMARY KEY,
  comment_id integer NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  state text NOT NULL DEFAULT 'pending'
);

CREATE TABLE IF NOT EXISTS snapshots (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  name text NOT NULL,
  seq integer NOT NULL,
  at timestamptz NOT NULL,
  automatic boolean NOT NULL DEFAULT false,
  payload jsonb NOT NULL
);

CREATE TABLE IF NOT EXISTS share_links (
  id serial PRIMARY KEY,
  sprite_id integer NOT NULL REFERENCES sprites(id) ON DELETE CASCADE,
  label text NOT NULL,
  token text NOT NULL UNIQUE,
  state text NOT NULL DEFAULT 'active',
  expires_at timestamptz,
  created_at timestamptz NOT NULL,
  end_notified boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS imports (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprite_id integer REFERENCES sprites(id) ON DELETE SET NULL,
  file_name text NOT NULL,
  object_key text NOT NULL,
  size integer NOT NULL,
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  sprite_id integer REFERENCES sprites(id) ON DELETE CASCADE,
  kind text NOT NULL,
  state text NOT NULL DEFAULT 'queued',
  done integer NOT NULL DEFAULT 0,
  total integer NOT NULL DEFAULT 0,
  settings jsonb NOT NULL,
  seq integer NOT NULL DEFAULT 0,
  cancel_requested boolean NOT NULL DEFAULT false,
  lease_until timestamptz,
  by_user_id integer REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS exports (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  job_id integer NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  label text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  seq integer NOT NULL,
  files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS activity (
  id serial PRIMARY KEY,
  project_id integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind text NOT NULL,
  user_id integer REFERENCES users(id) ON DELETE SET NULL,
  user_name text NOT NULL,
  sprite_id integer,
  sprite_name text,
  pixels integer NOT NULL DEFAULT 0,
  strokes integer NOT NULL DEFAULT 0,
  frame integer,
  detail text,
  at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS drafts (
  user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key text NOT NULL,
  text text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS mail_outbox (
  id serial PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  state text NOT NULL DEFAULT 'pending',
  attempts integer NOT NULL DEFAULT 0,
  mention_id integer REFERENCES comment_mentions(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL,
  sent_at timestamptz
);
