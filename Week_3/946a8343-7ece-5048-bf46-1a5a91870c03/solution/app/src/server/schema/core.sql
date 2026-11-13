-- Core tables. Every statement is idempotent; the app applies this file on every start.

CREATE TABLE IF NOT EXISTS users (
  id          serial PRIMARY KEY,
  username    text NOT NULL UNIQUE,
  password    text,
  time_zone   text NOT NULL DEFAULT 'UTC',
  created_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash  text PRIMARY KEY,
  user_id     integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS groups (
  id          serial PRIMARY KEY,
  path        text NOT NULL UNIQUE,
  name        text NOT NULL,
  parent_id   integer REFERENCES groups(id),
  visibility  text NOT NULL CHECK (visibility IN ('private', 'internal', 'public')),
  created_at  bigint NOT NULL
);

CREATE TABLE IF NOT EXISTS custom_roles (
  id           serial PRIMARY KEY,
  group_id     integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  name         text NOT NULL,
  base         text NOT NULL,
  permissions  text[] NOT NULL DEFAULT '{}',
  UNIQUE (group_id, name)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id        integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id         integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text,
  custom_role_id  integer REFERENCES custom_roles(id),
  PRIMARY KEY (group_id, user_id)
);
CREATE INDEX IF NOT EXISTS group_members_user ON group_members (user_id);

CREATE TABLE IF NOT EXISTS projects (
  id                       serial PRIMARY KEY,
  group_id                 integer NOT NULL REFERENCES groups(id),
  slug                     text NOT NULL,
  path                     text NOT NULL UNIQUE,
  visibility               text NOT NULL CHECK (visibility IN ('private', 'internal', 'public')),
  default_branch           text NOT NULL,
  seq                      integer NOT NULL DEFAULT 0,
  merge_method             text NOT NULL DEFAULT 'merge_commit',
  merge_trains             boolean NOT NULL DEFAULT false,
  pipelines_must_succeed   boolean NOT NULL DEFAULT false,
  reset_approvals_on_push  boolean NOT NULL DEFAULT true,
  author_can_approve       boolean NOT NULL DEFAULT false,
  auto_resolve_outdated    boolean NOT NULL DEFAULT false,
  next_mr_iid              integer NOT NULL DEFAULT 1,
  next_issue_iid           integer NOT NULL DEFAULT 1,
  created_at               bigint NOT NULL,
  UNIQUE (group_id, slug)
);

CREATE TABLE IF NOT EXISTS project_members (
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id         integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role            text,
  custom_role_id  integer REFERENCES custom_roles(id),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS project_members_user ON project_members (user_id);

CREATE TABLE IF NOT EXISTS protected_branches (
  project_id        integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern           text NOT NULL,
  allowed_to_push   text NOT NULL,
  allowed_to_merge  text NOT NULL,
  PRIMARY KEY (project_id, pattern)
);

CREATE TABLE IF NOT EXISTS protected_tags (
  project_id         integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  pattern            text NOT NULL,
  allowed_to_create  text NOT NULL,
  PRIMARY KEY (project_id, pattern)
);

CREATE TABLE IF NOT EXISTS push_rules (
  project_id       integer PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
  branch_name      text,
  commit_message   text,
  forbidden_files  text[] NOT NULL DEFAULT '{}',
  required_files   text[] NOT NULL DEFAULT '{}',
  secrets          boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS approval_rules (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  required    integer NOT NULL,
  users       text[] NOT NULL DEFAULT '{}',
  groups      text[] NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS approval_rules_project ON approval_rules (project_id, id);

CREATE TABLE IF NOT EXISTS project_variables (
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key         text NOT NULL,
  value       text NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS protected_environments (
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name        text NOT NULL,
  roles       text NOT NULL,
  approvals   integer NOT NULL,
  PRIMARY KEY (project_id, name)
);

CREATE TABLE IF NOT EXISTS live_messages (
  project_id      integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  seq             integer NOT NULL,
  type            text NOT NULL,
  data            jsonb NOT NULL,
  restrict_user   integer,
  restrict_issue  integer,
  at              bigint NOT NULL,
  PRIMARY KEY (project_id, seq)
);

CREATE TABLE IF NOT EXISTS audit_events (
  id          serial PRIMARY KEY,
  project_id  integer REFERENCES projects(id) ON DELETE CASCADE,
  group_id    integer REFERENCES groups(id) ON DELETE CASCADE,
  actor       text NOT NULL,
  action      text NOT NULL,
  target      text NOT NULL,
  before      jsonb,
  after       jsonb,
  at          bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_project ON audit_events (project_id, id DESC);
CREATE INDEX IF NOT EXISTS audit_events_group ON audit_events (group_id, id DESC);

CREATE TABLE IF NOT EXISTS idempotency_keys (
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key          text NOT NULL,
  fingerprint  text NOT NULL,
  status       integer NOT NULL,
  body         text NOT NULL,
  created_at   bigint NOT NULL,
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS presence (
  project_id   integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mr_iid       integer NOT NULL,
  user_id      integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  connections  integer NOT NULL DEFAULT 0,
  expires_at   bigint,
  PRIMARY KEY (project_id, mr_iid, user_id)
);

CREATE TABLE IF NOT EXISTS rate_hits (
  bucket  text NOT NULL,
  minute  bigint NOT NULL,
  hits    integer NOT NULL,
  PRIMARY KEY (bucket, minute)
);
CREATE INDEX IF NOT EXISTS rate_hits_minute ON rate_hits (minute);
