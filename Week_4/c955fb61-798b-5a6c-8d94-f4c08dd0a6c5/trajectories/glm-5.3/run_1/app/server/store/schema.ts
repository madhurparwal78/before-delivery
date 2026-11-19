// Postgres schema, applied idempotently at every boot.

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id text PRIMARY KEY,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  capacity numeric NOT NULL DEFAULT 8,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS members (
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  role text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  token text PRIMARY KEY,
  user_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS projects (
  id text PRIMARY KEY,
  workspace_id text NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS items (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  row int NOT NULL,
  name text NOT NULL,
  kind text NOT NULL,
  group_id text,
  chosen_start date,
  duration int NOT NULL,
  percent int NOT NULL,
  version int NOT NULL DEFAULT 1,
  version_by text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS links (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  from_id text NOT NULL,
  to_id text NOT NULL,
  type text NOT NULL,
  lag int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS holidays (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  date date NOT NULL,
  name text NOT NULL,
  PRIMARY KEY (project_id, date)
);

CREATE TABLE IF NOT EXISTS assignments (
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  hours numeric NOT NULL,
  PRIMARY KEY (item_id, user_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id text PRIMARY KEY,
  item_id text NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  author_id text NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  text text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS baselines (
  project_id text PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  finish date NOT NULL
);

CREATE TABLE IF NOT EXISTS baseline_items (
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  item_id text NOT NULL,
  start date NOT NULL,
  "end" date NOT NULL,
  PRIMARY KEY (project_id, item_id)
);

CREATE TABLE IF NOT EXISTS notices (
  id text PRIMARY KEY,
  assigner_id text NOT NULL,
  assignee_id text NOT NULL,
  item_id text NOT NULL,
  project_id text NOT NULL,
  hours numeric NOT NULL,
  due_at timestamptz NOT NULL,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS exports (
  id text PRIMARY KEY,
  project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  format text NOT NULL,
  filename text NOT NULL,
  stored_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS items_project_row ON items(project_id, row);
CREATE INDEX IF NOT EXISTS links_project ON links(project_id);
CREATE INDEX IF NOT EXISTS comments_item ON comments(item_id, created_at);
CREATE INDEX IF NOT EXISTS notices_pending ON notices(sent_at) WHERE sent_at IS NULL;
`;

export async function applySchema(pool: { query(sql: string): Promise<unknown> }): Promise<void> {
  await pool.query(SCHEMA);
}
