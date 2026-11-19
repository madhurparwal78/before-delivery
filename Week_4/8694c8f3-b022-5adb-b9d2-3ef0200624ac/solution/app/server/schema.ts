export const SCHEMA_LOCK_KEY = 7_234_001;

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS sets (
  id uuid PRIMARY KEY,
  name text NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id),
  bpm double precision NOT NULL DEFAULT 120,
  head integer NOT NULL DEFAULT 0,
  settings_version integer NOT NULL DEFAULT 1,
  graph_version integer NOT NULL DEFAULT 1,
  graph jsonb NOT NULL DEFAULT '{"nodes":[],"wires":[]}',
  active_camera_id uuid,
  show_token text NOT NULL UNIQUE,
  live_number integer,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS members (
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (set_id, user_id)
);
CREATE TABLE IF NOT EXISTS invites (
  token text PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  role text NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  used_by uuid REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS layers (
  id uuid PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  parent_id uuid,
  idx integer NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  version integer NOT NULL,
  visible boolean NOT NULL,
  position jsonb NOT NULL,
  rotation jsonb NOT NULL,
  scale jsonb NOT NULL,
  props jsonb NOT NULL,
  material jsonb,
  model_asset_id uuid,
  output_buses jsonb NOT NULL,
  shader_version integer
);
CREATE INDEX IF NOT EXISTS layers_set_idx ON layers(set_id);
CREATE TABLE IF NOT EXISTS layer_keys (
  layer_id uuid NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  property text NOT NULL,
  tick integer NOT NULL,
  value double precision NOT NULL,
  PRIMARY KEY (layer_id, property, tick)
);
CREATE TABLE IF NOT EXISTS scripts (
  id uuid PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  name text NOT NULL,
  version integer NOT NULL,
  source text NOT NULL,
  asset_ids jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS ops (
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  client_op_id text NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  target text NOT NULL,
  type text NOT NULL,
  base_version integer,
  payload jsonb NOT NULL,
  response jsonb NOT NULL,
  committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (set_id, seq),
  UNIQUE (set_id, client_op_id)
);
CREATE INDEX IF NOT EXISTS ops_target_idx ON ops(set_id, target, seq);
CREATE TABLE IF NOT EXISTS shader_versions (
  layer_id uuid NOT NULL REFERENCES layers(id) ON DELETE CASCADE,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  number integer NOT NULL,
  source text NOT NULL,
  sha256 text NOT NULL,
  size integer NOT NULL,
  author_id uuid NOT NULL REFERENCES users(id),
  restored_from integer,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (layer_id, number)
);
CREATE TABLE IF NOT EXISTS assets (
  id uuid PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL,
  size integer NOT NULL,
  sha256 text NOT NULL,
  status text NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS assets_set_idx ON assets(set_id);
CREATE TABLE IF NOT EXISTS show_versions (
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  number integer NOT NULL,
  status text NOT NULL,
  sha256 text NOT NULL,
  size integer NOT NULL,
  note text NOT NULL,
  asset_ids jsonb NOT NULL,
  published_by uuid NOT NULL REFERENCES users(id),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (set_id, number)
);
CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  sha256 text NOT NULL,
  size integer NOT NULL,
  created_by uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS activity (
  id bigserial PRIMARY KEY,
  set_id uuid NOT NULL REFERENCES sets(id) ON DELETE CASCADE,
  at timestamptz NOT NULL DEFAULT clock_timestamp(),
  actor_id uuid NOT NULL REFERENCES users(id),
  action text NOT NULL,
  target text NOT NULL,
  summary text NOT NULL
);
CREATE INDEX IF NOT EXISTS activity_set_idx ON activity(set_id, id DESC);
`;
