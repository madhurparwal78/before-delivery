export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS directory_cache (
  id          text PRIMARY KEY,
  name        text NOT NULL,
  email       text NOT NULL,
  firm        text NOT NULL,
  kind        text NOT NULL,
  staff_role  text,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  id         text PRIMARY KEY,
  person_id  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS folders (
  id         text PRIMARY KEY,
  name       text NOT NULL,
  parent_id  text REFERENCES folders(id),
  owner_id   text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS folders_parent_idx ON folders(parent_id);

CREATE TABLE IF NOT EXISTS files (
  id           text PRIMARY KEY,
  name         text NOT NULL,
  folder_id    text NOT NULL REFERENCES folders(id),
  size         bigint NOT NULL,
  content_type text NOT NULL,
  modified_at  timestamptz NOT NULL,
  locked       boolean NOT NULL DEFAULT false,
  state        text NOT NULL DEFAULT 'live',
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS files_folder_idx ON files(folder_id, state);

CREATE TABLE IF NOT EXISTS bin_items (
  file_id        text PRIMARY KEY REFERENCES files(id) ON DELETE CASCADE,
  from_folder_id text NOT NULL REFERENCES folders(id),
  binned_date    date NOT NULL,
  retention_days integer NOT NULL,
  purge_date     date NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  id            text PRIMARY KEY,
  item_type     text NOT NULL,
  item_id       text NOT NULL,
  person_id     text NOT NULL,
  role          text NOT NULL,
  end_date      date NOT NULL,
  status        text NOT NULL DEFAULT 'active',
  ended_reason  text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS grants_one_active
  ON grants(item_type, item_id, person_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS grants_person_idx ON grants(person_id, status);

CREATE TABLE IF NOT EXISTS uploads (
  id               text PRIMARY KEY,
  person_id        text NOT NULL,
  folder_id        text NOT NULL REFERENCES folders(id),
  name             text NOT NULL,
  size             bigint NOT NULL,
  content_type     text NOT NULL,
  state            text NOT NULL,
  storage_upload_id text NOT NULL,
  parts            jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_activity_at timestamptz NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS uploads_person_idx ON uploads(person_id, state);

CREATE TABLE IF NOT EXISTS storage_debris (
  id                text PRIMARY KEY,
  storage_upload_id text,
  purpose           text NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ledger (
  id        text PRIMARY KEY,
  seq       bigserial,
  at        timestamptz NOT NULL,
  actor_id  text,
  action    text NOT NULL,
  file_id   text,
  folder_id text,
  detail    jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ledger_file_idx ON ledger(file_id, seq DESC);
CREATE INDEX IF NOT EXISTS ledger_folder_idx ON ledger(folder_id, seq DESC);

CREATE TABLE IF NOT EXISTS handovers (
  id           text PRIMARY KEY,
  folder_id    text NOT NULL REFERENCES folders(id),
  from_id      text NOT NULL,
  to_id        text NOT NULL,
  offered_date date NOT NULL,
  lapse_date   date NOT NULL,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS handovers_one_open
  ON handovers(folder_id) WHERE status = 'offered';

CREATE TABLE IF NOT EXISTS policies (
  id             text PRIMARY KEY,
  kind           text NOT NULL,
  days           integer NOT NULL,
  effective_from date NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS policies_kind_date ON policies(kind, effective_from);

CREATE TABLE IF NOT EXISTS idempotency_records (
  person_id  text NOT NULL,
  key        text NOT NULL,
  scope      text NOT NULL,
  body_hash  text NOT NULL,
  status     integer NOT NULL,
  response   json NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (person_id, key)
);
`;
