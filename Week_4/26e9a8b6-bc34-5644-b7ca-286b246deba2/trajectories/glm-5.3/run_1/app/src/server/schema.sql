-- Pennywasher schema: Postgres holds every record.

CREATE TABLE IF NOT EXISTS accounts (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS confirm_tokens (
  token text PRIMARY KEY,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  sent_at timestamptz NOT NULL DEFAULT now(),
  used_at timestamptz
);

CREATE TABLE IF NOT EXISTS models (
  id text PRIMARY KEY,
  bytes integer NOT NULL,
  sha256 text NOT NULL,
  bbox_mm jsonb NOT NULL,
  scale real NOT NULL DEFAULT 1,
  scale_confirmed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guides (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES accounts(id),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft','published','withdrawn')),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  currency text NOT NULL CHECK (currency IN ('EUR','GBP','USD','JPY')),
  revision integer NOT NULL DEFAULT 0,
  latest_version integer,
  published_version integer,
  model_id text REFERENCES models(id),
  forked_from_guide_id text REFERENCES guides(id),
  forked_from_title text,
  forked_from_author text,
  forked_from_version integer,
  search_vector tsvector,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS coauthors (
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  PRIMARY KEY (guide_id, account_id)
);

CREATE TABLE IF NOT EXISTS steps (
  id text PRIMARY KEY,
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position integer NOT NULL,
  title text NOT NULL,
  text text NOT NULL DEFAULT '',
  phase text NOT NULL DEFAULT 'open_up' CHECK (phase IN ('open_up','take_out','fit_new','close_up','test_it')),
  explode real NOT NULL DEFAULT 0,
  focus_parts jsonb NOT NULL DEFAULT '[]',
  camera jsonb NOT NULL,
  UNIQUE (guide_id, id)
);

CREATE TABLE IF NOT EXISTS parts (
  id text PRIMARY KEY,
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  name text NOT NULL,
  node_path text NOT NULL DEFAULT '',
  unbound boolean NOT NULL DEFAULT false,
  axis text NOT NULL DEFAULT 'y' CHECK (axis IN ('x','y','z')),
  apart_mm real NOT NULL DEFAULT 0,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity >= 1 AND quantity <= 999),
  unit_price bigint NOT NULL DEFAULT 0 CHECK (unit_price >= 0 AND unit_price <= 99999999),
  fitted_at text REFERENCES steps(id) ON DELETE SET NULL,
  position integer NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS callouts (
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  step_id text NOT NULL,
  part_id text NOT NULL,
  text text NOT NULL DEFAULT '',
  position integer NOT NULL DEFAULT 0,
  PRIMARY KEY (guide_id, step_id, part_id, position)
);

CREATE TABLE IF NOT EXISTS field_revisions (
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  field_path text NOT NULL,
  revision integer NOT NULL DEFAULT 0,
  updated_by text NOT NULL DEFAULT '',
  PRIMARY KEY (guide_id, field_path)
);

CREATE TABLE IF NOT EXISTS guide_tags (
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  tag text NOT NULL,
  PRIMARY KEY (guide_id, tag)
);

CREATE TABLE IF NOT EXISTS versions (
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  number integer NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  saved_by text NOT NULL,
  restored_from integer,
  steps jsonb NOT NULL,
  parts jsonb NOT NULL,
  model_id text,
  parts_cost bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (guide_id, number)
);

CREATE TABLE IF NOT EXISTS likes (
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  account_id text NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (guide_id, account_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id text PRIMARY KEY,
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  step integer NOT NULL,
  text text NOT NULL,
  asked_by text NOT NULL REFERENCES accounts(id),
  asked_at timestamptz NOT NULL DEFAULT now(),
  answer text,
  answered_by text REFERENCES accounts(id),
  answered_at timestamptz
);

CREATE TABLE IF NOT EXISTS collections (
  id text PRIMARY KEY,
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  owner_id text NOT NULL REFERENCES accounts(id),
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public','private')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id text NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  guide_id text NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position integer NOT NULL,
  PRIMARY KEY (collection_id, guide_id)
);

CREATE TABLE IF NOT EXISTS rate_events (
  key text PRIMARY KEY,
  window_start timestamptz NOT NULL,
  count integer NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS steps_guide_position ON steps (guide_id, position);
CREATE INDEX IF NOT EXISTS parts_guide ON parts (guide_id);
CREATE INDEX IF NOT EXISTS questions_guide ON questions (guide_id, asked_at DESC);
CREATE INDEX IF NOT EXISTS versions_guide ON versions (guide_id, number DESC);
CREATE INDEX IF NOT EXISTS collection_items_position ON collection_items (collection_id, position);
CREATE INDEX IF NOT EXISTS confirm_tokens_account ON confirm_tokens (account_id);
