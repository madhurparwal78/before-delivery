// Postgres schema, applied idempotently at start (under an advisory lock) by db.ts.
// Times are timestamptz; "now" in a rule always comes from the workspace clock (clock.ts), never now().

export const SCHEMA = `
CREATE TABLE IF NOT EXISTS workspaces (
  id uuid PRIMARY KEY,
  time_zone text NOT NULL,
  created_at timestamptz NOT NULL,
  -- grading clock: when set, workspace now = clock_base + (real now - clock_set_at)
  clock_base timestamptz,
  clock_set_at timestamptz
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  name text NOT NULL,
  email text NOT NULL,
  email_key text NOT NULL UNIQUE,            -- lower(email)
  password_hash text NOT NULL,
  time_zone text NOT NULL,
  verified boolean NOT NULL DEFAULT false,
  confirmed_at timestamptz,                  -- workspace now at confirmation
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash text PRIMARY KEY,               -- sha256 of the cookie value
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS verify_links (
  token text PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL,           -- workspace now
  replaced boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS signin_attempts (
  email_key text PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS quotes (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  day text NOT NULL,                         -- YYYYMMDD in the studio zone
  sequence integer NOT NULL,
  number text NOT NULL,
  sent_to text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (workspace_id, day, sequence)
);

CREATE TABLE IF NOT EXISTS folders (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  parent_id uuid REFERENCES folders(id),     -- null only for the workspace's My Drawings root
  name text NOT NULL,
  name_key text NOT NULL,                    -- lower(name)
  created_at timestamptz NOT NULL,
  modified_at timestamptz NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS folders_unique_name ON folders (parent_id, name_key) WHERE parent_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS folders_one_root ON folders (workspace_id) WHERE parent_id IS NULL;

CREATE TABLE IF NOT EXISTS drawings (
  id uuid PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  folder_id uuid REFERENCES folders(id),     -- null for sample drawings
  name text NOT NULL,
  name_key text NOT NULL,
  sample boolean NOT NULL DEFAULT false,     -- owner "Corbel Works", opened with view access
  units text NOT NULL,
  plot_style text NOT NULL DEFAULT 'Monochrome',
  version integer NOT NULL DEFAULT 1,
  next_handle bigint NOT NULL DEFAULT 16,    -- numeric value of the next handle (0x10 = "10")
  next_trace_handle integer NOT NULL DEFAULT 1,
  export_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL,
  modified_at timestamptz NOT NULL,
  deleted_at timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS drawings_unique_name ON drawings (folder_id, name_key) WHERE deleted_at IS NULL AND folder_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS layers (
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  name text NOT NULL,
  position integer NOT NULL,
  color text NOT NULL,
  linetype text NOT NULL,
  lineweight text NOT NULL,
  on_ boolean NOT NULL,
  frozen boolean NOT NULL,
  locked boolean NOT NULL,
  current boolean NOT NULL,
  PRIMARY KEY (drawing_id, name)
);

CREATE TABLE IF NOT EXISTS objects (
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  handle text NOT NULL,
  seq bigint NOT NULL,                       -- creation order
  data jsonb NOT NULL,                       -- StoredObject
  PRIMARY KEY (drawing_id, handle)
);

CREATE TABLE IF NOT EXISTS layouts (
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  name text NOT NULL,
  position integer NOT NULL,
  viewport_scale text,                       -- null for Model
  PRIMARY KEY (drawing_id, name)
);

-- One row per base edit that changed the drawing: the version it produced, what it touched, and the images for undo/redo.
CREATE TABLE IF NOT EXISTS changes (
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  version integer NOT NULL,
  actor_key text NOT NULL,                   -- user id or share id
  actor_name text NOT NULL,
  command text NOT NULL,
  created text[] NOT NULL,
  modified text[] NOT NULL,
  erased text[] NOT NULL,
  before jsonb NOT NULL,                     -- engine Patch
  after jsonb NOT NULL,
  undone boolean NOT NULL DEFAULT false,
  at timestamptz NOT NULL,                   -- workspace now
  PRIMARY KEY (drawing_id, version)
);

CREATE TABLE IF NOT EXISTS xrefs (
  id uuid PRIMARY KEY,
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  source_drawing_id uuid NOT NULL REFERENCES drawings(id),
  loaded boolean NOT NULL DEFAULT true,
  position integer NOT NULL
);

CREATE TABLE IF NOT EXISTS file_versions (
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  number integer NOT NULL,
  actor text NOT NULL,
  size_bytes integer NOT NULL,
  object_key text NOT NULL,
  created_at timestamptz NOT NULL,
  PRIMARY KEY (drawing_id, number)
);

CREATE TABLE IF NOT EXISTS recents (
  user_id uuid NOT NULL REFERENCES users(id),
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  opened_at timestamptz NOT NULL,
  PRIMARY KEY (user_id, drawing_id)
);

CREATE TABLE IF NOT EXISTS shares (
  id uuid PRIMARY KEY,
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  token text NOT NULL UNIQUE,
  access text NOT NULL,
  recipient_email text NOT NULL,
  recipient_name text NOT NULL,
  expiry_date date,
  expires_at timestamptz,
  time_zone text NOT NULL,
  revoked_at timestamptz,
  last_invite_at timestamptz,
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS traces (
  id uuid PRIMARY KEY,
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  name text NOT NULL,
  author_key text NOT NULL,                  -- share id or user id of the author
  author_name text NOT NULL,
  state text NOT NULL,
  notice text,                               -- 'sent' | 'not_sent' once submitted
  created_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS trace_objects (
  trace_id uuid NOT NULL REFERENCES traces(id),
  handle text NOT NULL,
  seq bigint NOT NULL,
  data jsonb NOT NULL,
  PRIMARY KEY (trace_id, handle)
);

CREATE TABLE IF NOT EXISTS issues (
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  number integer NOT NULL,
  trace_id uuid NOT NULL REFERENCES traces(id),
  text text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  PRIMARY KEY (drawing_id, number)
);

CREATE TABLE IF NOT EXISTS exports (
  id uuid PRIMARY KEY,
  drawing_id uuid NOT NULL REFERENCES drawings(id),
  seq integer NOT NULL,
  format text NOT NULL,
  layout text NOT NULL,
  file text NOT NULL,
  state text NOT NULL,
  issued_at timestamptz NOT NULL,
  issue_date text NOT NULL,                  -- YYYY-MM-DD in the studio zone
  title_block_revision text NOT NULL,
  object_key text,
  size_bytes integer
);

CREATE TABLE IF NOT EXISTS title_revisions (
  workspace_id uuid NOT NULL REFERENCES workspaces(id),
  letter text NOT NULL,
  footer_note text NOT NULL,
  effective_date date NOT NULL,
  PRIMARY KEY (workspace_id, letter)
);

CREATE INDEX IF NOT EXISTS users_workspace ON users (workspace_id);
CREATE INDEX IF NOT EXISTS folders_parent ON folders (parent_id);
CREATE INDEX IF NOT EXISTS drawings_folder ON drawings (folder_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS drawings_workspace ON drawings (workspace_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS shares_drawing ON shares (drawing_id);
CREATE INDEX IF NOT EXISTS verify_links_user ON verify_links (user_id);
CREATE INDEX IF NOT EXISTS recents_latest ON recents (user_id, opened_at DESC);
`;
