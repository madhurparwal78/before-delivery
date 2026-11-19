CREATE TABLE IF NOT EXISTS users (
  id           uuid PRIMARY KEY,
  name         text NOT NULL,
  email        text NOT NULL,
  password_hash text NOT NULL,
  confirmed    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_key ON users (lower(email));

CREATE TABLE IF NOT EXISTS confirm_tokens (
  token      text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  sent_at    timestamptz NOT NULL DEFAULT now(),
  spent      boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS confirm_tokens_user ON confirm_tokens (user_id);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS models (
  id         uuid PRIMARY KEY,
  bytes      bigint NOT NULL,
  sha256     text NOT NULL,
  bbox_mm    double precision[] NOT NULL,
  node_paths text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS guides (
  id                 uuid PRIMARY KEY,
  slug               text NOT NULL UNIQUE,
  owner_id           uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title              text NOT NULL,
  currency           text NOT NULL,
  tags               text[] NOT NULL DEFAULT '{}',
  visibility         text NOT NULL DEFAULT 'public',
  state              text NOT NULL DEFAULT 'draft',
  published_version  integer,
  published_at       timestamptz,
  model_id           uuid REFERENCES models(id),
  model_scale        double precision NOT NULL DEFAULT 1,
  model_scale_confirmed boolean NOT NULL DEFAULT false,
  revision           integer NOT NULL DEFAULT 0,
  search_text        text NOT NULL DEFAULT '',
  forked_from_guide_id uuid,
  forked_from_title    text,
  forked_from_author   text,
  forked_from_version  integer,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS guides_owner ON guides (owner_id);
CREATE INDEX IF NOT EXISTS guides_forked_from ON guides (forked_from_guide_id);
CREATE INDEX IF NOT EXISTS guides_published ON guides (published_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS guide_coauthors (
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (guide_id, user_id)
);

CREATE TABLE IF NOT EXISTS parts (
  id         uuid PRIMARY KEY,
  guide_id   uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position   integer NOT NULL,
  name       text NOT NULL,
  node_path  text,
  axis       text NOT NULL DEFAULT 'y',
  apart_mm   double precision NOT NULL DEFAULT 0,
  quantity   integer NOT NULL DEFAULT 1,
  unit_price bigint NOT NULL DEFAULT 0,
  fitted_at  uuid,
  bbox_min   double precision[] NOT NULL DEFAULT '{0,0,0}',
  bbox_max   double precision[] NOT NULL DEFAULT '{0,0,0}',
  colour     double precision[] NOT NULL DEFAULT '{0.6,0.6,0.6}'
);
CREATE INDEX IF NOT EXISTS parts_guide ON parts (guide_id, position);

CREATE TABLE IF NOT EXISTS steps (
  id          uuid PRIMARY KEY,
  guide_id    uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position    integer NOT NULL,
  title       text NOT NULL DEFAULT '',
  body_text   text NOT NULL DEFAULT '',
  phase       text NOT NULL DEFAULT 'open_up',
  explode     double precision NOT NULL DEFAULT 0,
  focus_parts uuid[] NOT NULL DEFAULT '{}',
  yaw         integer NOT NULL DEFAULT 30,
  pitch       integer NOT NULL DEFAULT 15,
  zoom        double precision NOT NULL DEFAULT 1,
  callouts    jsonb NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS steps_guide ON steps (guide_id, position);

CREATE TABLE IF NOT EXISTS field_revisions (
  guide_id   uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  field_path text NOT NULL,
  revision   integer NOT NULL DEFAULT 0,
  updated_by uuid,
  PRIMARY KEY (guide_id, field_path)
);

CREATE TABLE IF NOT EXISTS versions (
  guide_id      uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  number        integer NOT NULL,
  saved_at      timestamptz NOT NULL DEFAULT now(),
  saved_by      uuid REFERENCES users(id),
  restored_from integer,
  base_version  integer,
  snapshot      jsonb NOT NULL,
  PRIMARY KEY (guide_id, number)
);

CREATE TABLE IF NOT EXISTS likes (
  guide_id uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  user_id  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (guide_id, user_id)
);

CREATE TABLE IF NOT EXISTS questions (
  id          uuid PRIMARY KEY,
  guide_id    uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  step        integer NOT NULL,
  text        text NOT NULL,
  asked_by    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  asked_at    timestamptz NOT NULL DEFAULT now(),
  answer_text text,
  answered_by uuid REFERENCES users(id),
  answered_at timestamptz
);
CREATE INDEX IF NOT EXISTS questions_guide ON questions (guide_id, asked_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS collections (
  id         uuid PRIMARY KEY,
  slug       text NOT NULL UNIQUE,
  owner_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      text NOT NULL,
  visibility text NOT NULL DEFAULT 'public',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS collection_items (
  collection_id uuid NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  guide_id      uuid NOT NULL REFERENCES guides(id) ON DELETE CASCADE,
  position      integer NOT NULL,
  PRIMARY KEY (collection_id, guide_id)
);

CREATE TABLE IF NOT EXISTS rate_events (
  kind       text NOT NULL,
  subject    text NOT NULL,
  happened_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_events_lookup ON rate_events (kind, subject, happened_at DESC);
