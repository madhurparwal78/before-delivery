export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS profile (
  only_row boolean PRIMARY KEY DEFAULT true CHECK (only_row),
  display_name text NOT NULL,
  unit text NOT NULL,
  goal_grams integer NOT NULL,
  time_zone text NOT NULL,
  paper_size text NOT NULL,
  passphrase_hash text NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  normalised_name text NOT NULL,
  category text NOT NULL,
  weight_grams integer NOT NULL,
  units_owned integer NOT NULL,
  status text NOT NULL DEFAULT 'active',
  price_cents integer,
  notes text NOT NULL DEFAULT '',
  version integer NOT NULL DEFAULT 1,
  photo_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL,
  UNIQUE (normalised_name, category)
);

CREATE TABLE IF NOT EXISTS photos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  object_key text NOT NULL,
  content_type text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trip_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  state text NOT NULL DEFAULT 'planning',
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);

CREATE TABLE IF NOT EXISTS lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES trip_lists(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  quantity integer NOT NULL,
  mode text NOT NULL DEFAULT 'base',
  frozen_name text,
  frozen_weight_grams integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL,
  UNIQUE (list_id, item_id)
);

CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES trip_lists(id) ON DELETE CASCADE,
  token text NOT NULL UNIQUE,
  expires_on date,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS pack_sheets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES trip_lists(id) ON DELETE CASCADE,
  paper_size text NOT NULL,
  object_key text NOT NULL,
  bytes integer NOT NULL,
  content jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);

CREATE TABLE IF NOT EXISTS import_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  filename text NOT NULL,
  bytes integer NOT NULL,
  object_key text NOT NULL,
  status text NOT NULL DEFAULT 'previewed',
  uploaded_at timestamptz NOT NULL DEFAULT now(),
  seq bigserial NOT NULL
);

CREATE TABLE IF NOT EXISTS import_rows (
  import_id uuid NOT NULL REFERENCES import_runs(id) ON DELETE CASCADE,
  row integer NOT NULL,
  name text NOT NULL,
  category text NOT NULL,
  outcome text NOT NULL,
  item_id uuid REFERENCES items(id) ON DELETE SET NULL,
  same_as_row integer,
  reason text,
  normalised_name text,
  canonical_category text,
  weight_grams integer,
  units_owned integer,
  notes text,
  price_cents integer,
  PRIMARY KEY (import_id, row)
);

CREATE TABLE IF NOT EXISTS sync_ops (
  op_id text PRIMARY KEY,
  op text NOT NULL,
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS retirement_keys (
  item_id uuid NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  key text NOT NULL,
  body text NOT NULL,
  state text NOT NULL,
  status integer,
  response jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (item_id, key)
);
`;
