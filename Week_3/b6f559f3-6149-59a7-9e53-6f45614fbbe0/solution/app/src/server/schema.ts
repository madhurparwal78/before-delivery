/** Core tables. Every statement is idempotent; `migrate()` runs them under an advisory lock at every start. */
export const SCHEMA: string[] = [
  `CREATE TABLE IF NOT EXISTS app_clock (
     id integer PRIMARY KEY CHECK (id = 1),
     offset_ms bigint NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS people (
     id text PRIMARY KEY,
     name text NOT NULL,
     email text NOT NULL,
     password_hash text NOT NULL,
     created_at timestamptz NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS people_email ON people (lower(email))`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token text PRIMARY KEY,
     person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
     created_at timestamptz NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS workspaces (
     id text PRIMARY KEY,
     name text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS workspace_members (
     workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
     person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
     role text NOT NULL,
     PRIMARY KEY (workspace_id, person_id)
   )`,
  `CREATE TABLE IF NOT EXISTS projects (
     id text PRIMARY KEY,
     workspace_id text NOT NULL REFERENCES workspaces (id) ON DELETE CASCADE,
     name text NOT NULL,
     status text NOT NULL DEFAULT 'active',
     trashed_at timestamptz,
     purge_at timestamptz,
     imported boolean NOT NULL DEFAULT false,
     created_by text NOT NULL REFERENCES people (id),
     created_at timestamptz NOT NULL,
     seq bigint NOT NULL DEFAULT 0
   )`,
  `CREATE TABLE IF NOT EXISTS members (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
     role text NOT NULL,
     added_at timestamptz NOT NULL,
     PRIMARY KEY (project_id, person_id)
   )`,
  `CREATE INDEX IF NOT EXISTS members_person ON members (person_id)`,
  `CREATE TABLE IF NOT EXISTS scenes (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     id text NOT NULL,
     position bigserial,
     name text NOT NULL,
     fields jsonb NOT NULL,
     PRIMARY KEY (project_id, id)
   )`,
  `CREATE TABLE IF NOT EXISTS layers (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     id text NOT NULL,
     scene_id text NOT NULL,
     idx bigserial,
     parent_id text,
     ord integer NOT NULL,
     name text NOT NULL,
     kind text NOT NULL,
     visible boolean NOT NULL,
     locked boolean NOT NULL,
     mask_above boolean NOT NULL,
     blend_mode text NOT NULL,
     props jsonb NOT NULL,
     overrides jsonb NOT NULL,
     keyframes jsonb NOT NULL,
     events jsonb NOT NULL,
     bindings jsonb NOT NULL,
     PRIMARY KEY (project_id, id)
   )`,
  `CREATE TABLE IF NOT EXISTS variables (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     name text NOT NULL,
     position bigserial,
     type text NOT NULL,
     value jsonb NOT NULL,
     PRIMARY KEY (project_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS presets (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     name text NOT NULL,
     position bigserial,
     values jsonb NOT NULL,
     PRIMARY KEY (project_id, name)
   )`,
  `CREATE TABLE IF NOT EXISTS layer_locks (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     layer_id text NOT NULL,
     person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
     expires_at timestamptz NOT NULL,
     PRIMARY KEY (project_id, layer_id)
   )`,
  `CREATE TABLE IF NOT EXISTS op_history (
     id bigserial PRIMARY KEY,
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
     op_id text NOT NULL,
     undone boolean NOT NULL DEFAULT false,
     before jsonb NOT NULL,
     after jsonb NOT NULL,
     created_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS op_history_person ON op_history (project_id, person_id, id)`,
  `CREATE TABLE IF NOT EXISTS ops (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     person_id text NOT NULL REFERENCES people (id) ON DELETE CASCADE,
     op_id text NOT NULL,
     body_hash text NOT NULL,
     response jsonb NOT NULL,
     created_at timestamptz NOT NULL,
     PRIMARY KEY (project_id, person_id, op_id)
   )`,
  `CREATE TABLE IF NOT EXISTS idempotency (
     scope text NOT NULL,
     key text NOT NULL,
     request_hash text NOT NULL,
     status integer NOT NULL,
     response jsonb NOT NULL,
     created_at timestamptz NOT NULL,
     PRIMARY KEY (scope, key)
   )`,
  // Shared with fork S2 (uploads and publishing): S2 may add columns in SERVICES_SCHEMA with ADD COLUMN IF NOT EXISTS.
  `CREATE TABLE IF NOT EXISTS assets (
     id text PRIMARY KEY,
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     kind text NOT NULL,
     file_name text NOT NULL,
     content_type text NOT NULL,
     bytes integer NOT NULL,
     sha256 text NOT NULL,
     status text NOT NULL,
     width integer,
     height integer,
     vertices integer,
     clips jsonb NOT NULL DEFAULT '[]',
     model jsonb,
     outline jsonb,
     created_at timestamptz NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS assets_project ON assets (project_id)`,
  `CREATE TABLE IF NOT EXISTS versions (
     project_id text NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
     number integer NOT NULL,
     status text NOT NULL,
     document jsonb NOT NULL,
     bundle bytea NOT NULL,
     sha256 text NOT NULL,
     published_by text NOT NULL REFERENCES people (id),
     published_at timestamptz NOT NULL,
     PRIMARY KEY (project_id, number)
   )`,
];
