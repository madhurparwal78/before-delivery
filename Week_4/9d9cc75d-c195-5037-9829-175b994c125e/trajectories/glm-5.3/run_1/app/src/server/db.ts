import pg from "pg";

/**
 * The app applies its schema idempotently every time it starts.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  explorers_schedule BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS members (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  PRIMARY KEY (project_id, user_id)
);

CREATE TABLE IF NOT EXISTS sources (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  relation JSONB,
  hierarchy JSONB,
  entitlement_field TEXT,
  entitlement_users JSONB,
  notices JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS tables (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rows_count INT NOT NULL DEFAULT 0,
  sha256 TEXT NOT NULL,
  columns JSONB NOT NULL,
  PRIMARY KEY (source_id, name)
);

CREATE TABLE IF NOT EXISTS fields (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  table_name TEXT NOT NULL,
  type TEXT NOT NULL,
  kind TEXT NOT NULL,
  continuous BOOLEAN NOT NULL,
  hidden BOOLEAN NOT NULL DEFAULT false,
  origin JSONB
);

CREATE TABLE IF NOT EXISTS snapshots (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  version INT NOT NULL DEFAULT 1,
  rows JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source_id, version)
);

CREATE TABLE IF NOT EXISTS extracts (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'live',
  stale BOOLEAN NOT NULL DEFAULT false,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  next_run_at TIMESTAMPTZ,
  rows_count INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schedules (
  source_id TEXT PRIMARY KEY REFERENCES sources(id) ON DELETE CASCADE,
  every_minutes INT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'full',
  key TEXT,
  last_run_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS refresh_failures (
  source_id TEXT NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
  times INT NOT NULL
);

CREATE TABLE IF NOT EXISTS workbooks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'draft',
  version INT NOT NULL DEFAULT 1,
  certified_by TEXT,
  source_id TEXT REFERENCES sources(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS sheets (
  id TEXT PRIMARY KEY,
  workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  owner_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  copy_of TEXT,
  version INT NOT NULL DEFAULT 1,
  shape JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS calculations (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  formula TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS parameters (
  id TEXT PRIMARY KEY,
  workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  value TEXT NOT NULL,
  values JSONB
);

CREATE TABLE IF NOT EXISTS sets (
  id TEXT PRIMARY KEY,
  workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  field TEXT NOT NULL,
  members JSONB,
  top JSONB
);

CREATE TABLE IF NOT EXISTS dashboards (
  id TEXT PRIMARY KEY,
  workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  version INT NOT NULL DEFAULT 1,
  layout JSONB NOT NULL,
  floating JSONB,
  phone_order JSONB,
  phone_heights JSONB,
  actions JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  sheet_id TEXT NOT NULL REFERENCES sheets(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  measure JSONB NOT NULL,
  above DOUBLE PRECISION NOT NULL,
  armed BOOLEAN NOT NULL DEFAULT true,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS inbox (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  read BOOLEAN NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS exports (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  target_name TEXT NOT NULL,
  filters JSONB NOT NULL,
  parameters JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  progress INT NOT NULL DEFAULT 0,
  sha256 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS grading_flags (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_members_user ON members(user_id);
CREATE INDEX IF NOT EXISTS idx_sources_project ON sources(project_id);
CREATE INDEX IF NOT EXISTS idx_fields_source ON fields(source_id);
CREATE INDEX IF NOT EXISTS idx_workbooks_project ON workbooks(project_id);
CREATE INDEX IF NOT EXISTS idx_sheets_workbook ON sheets(workbook_id);
CREATE INDEX IF NOT EXISTS idx_inbox_user ON inbox(user_id);
CREATE INDEX IF NOT EXISTS idx_exports_user ON exports(user_id);
`;

export type Db = pg.Pool;

export async function applySchema(db: Db): Promise<void> {
  await db.query(SCHEMA_SQL);
}

export async function connectWithRetry(databaseUrl: string, onRetry: () => void): Promise<Db> {
  for (;;) {
    try {
      const pool = new pg.Pool({ connectionString: databaseUrl, max: 10 });
      await pool.query("SELECT 1");
      await applySchema(pool);
      return pool;
    } catch {
      onRetry();
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
}
