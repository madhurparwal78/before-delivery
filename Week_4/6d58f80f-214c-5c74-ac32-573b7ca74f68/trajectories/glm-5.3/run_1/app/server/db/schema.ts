import pg from 'pg';

const SCHEMA_SQL = `
DROP CONSTRAINT IF EXISTS grants_person_id_item_type_item_id_status_key;
DROP CONSTRAINT IF EXISTS policies_kind_effective_from_key;
`;

const TABLES_SQL = `
CREATE TABLE IF NOT EXISTS people (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  firm TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('staff','partner')),
  staff_role TEXT
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  person_id TEXT NOT NULL REFERENCES people(id),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS folders (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES folders(id),
  project_id TEXT,
  owner_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  folder_id TEXT REFERENCES folders(id),
  size BIGINT NOT NULL,
  content_type TEXT NOT NULL,
  modified_at TIMESTAMPTZ NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL,
  purged BOOLEAN NOT NULL DEFAULT false,
  in_bin BOOLEAN NOT NULL DEFAULT false,
  binned_date DATE,
  bin_retention_days INTEGER,
  bin_from_folder TEXT,
  last_activity TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS grants (
  id TEXT PRIMARY KEY,
  item_type TEXT NOT NULL CHECK (item_type IN ('folder','file')),
  item_id TEXT NOT NULL,
  person_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('viewer','editor')),
  end_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ended')),
  ended_reason TEXT,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (person_id, item_type, item_id, status)
);

CREATE TABLE IF NOT EXISTS uploads (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  person_id TEXT NOT NULL,
  name TEXT NOT NULL,
  size BIGINT NOT NULL,
  content_type TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'started' CHECK (state IN ('started','uploading','paused','confirmed','cancelled','abandoned')),
  part_count INTEGER NOT NULL,
  confirmed_parts INTEGER[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL,
  last_progress_at TIMESTAMPTZ NOT NULL,
  idempotency_key TEXT,
  s3_upload_id TEXT
);

CREATE TABLE IF NOT EXISTS bin (
  file_id TEXT PRIMARY KEY REFERENCES files(id),
  from_folder TEXT NOT NULL,
  binned_date DATE NOT NULL,
  retention_days INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS policies (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('bin_retention_days','partner_grant_days')),
  days INTEGER NOT NULL,
  effective_from DATE NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (kind, effective_from)
);

CREATE TABLE IF NOT EXISTS handovers (
  id TEXT PRIMARY KEY,
  folder_id TEXT NOT NULL REFERENCES folders(id),
  from_person TEXT NOT NULL,
  to_person TEXT NOT NULL,
  offered_date DATE NOT NULL,
  lapse_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'offered' CHECK (status IN ('offered','accepted','declined','lapsed')),
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger (
  id TEXT PRIMARY KEY,
  at TIMESTAMPTZ NOT NULL,
  actor_id TEXT,
  actor_name TEXT,
  action TEXT NOT NULL,
  file_id TEXT,
  folder_id TEXT,
  detail JSONB NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS idempotency (
  key TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  path TEXT NOT NULL,
  body TEXT NOT NULL,
  status INTEGER NOT NULL,
  response TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_grants_item ON grants(item_type, item_id);
CREATE INDEX IF NOT EXISTS idx_grants_person ON grants(person_id);
CREATE INDEX IF NOT EXISTS idx_ledger_folder ON ledger(folder_id);
CREATE INDEX IF NOT EXISTS idx_ledger_file ON ledger(file_id);
CREATE INDEX IF NOT EXISTS idx_uploads_person ON uploads(person_id);
CREATE INDEX IF NOT EXISTS idx_uploads_state ON uploads(state);
`;

export async function applySchema(db: pg.Pool): Promise<void> {
  await db.query('ALTER TABLE grants DROP CONSTRAINT IF EXISTS grants_person_id_item_type_item_id_status_key');
  await db.query('ALTER TABLE policies DROP CONSTRAINT IF EXISTS policies_kind_effective_from_key');
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'grants_person_item_status') THEN
      ALTER TABLE grants ADD CONSTRAINT grants_person_item_status UNIQUE (person_id, item_type, item_id, status);
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'policies_kind_from') THEN
      ALTER TABLE policies ADD CONSTRAINT policies_kind_from UNIQUE (kind, effective_from);
    END IF;
  END $$;`);
  await db.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'files' AND column_name = 'bin_purge_pending') THEN
      ALTER TABLE files ADD COLUMN bin_purge_pending BOOLEAN NOT NULL DEFAULT false;
    END IF;
  END $$;`);
  await db.query(TABLES_SQL);
}
