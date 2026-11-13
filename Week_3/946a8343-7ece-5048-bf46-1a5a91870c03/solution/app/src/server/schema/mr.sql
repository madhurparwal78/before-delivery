-- mr tables (owned by the mr module). Idempotent: CREATE TABLE IF NOT EXISTS only.

CREATE TABLE IF NOT EXISTS merge_requests (
  id                   serial PRIMARY KEY,
  project_id           integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  iid                  integer NOT NULL,
  author_id            integer NOT NULL REFERENCES users(id),
  title                text NOT NULL,
  description          text NOT NULL DEFAULT '',
  source               text NOT NULL,
  target               text NOT NULL,
  state                text NOT NULL DEFAULT 'opened' CHECK (state IN ('opened', 'closed', 'merged')),
  delete_source_branch boolean NOT NULL DEFAULT false,
  assignees            text[] NOT NULL DEFAULT '{}',
  reviewers            text[] NOT NULL DEFAULT '{}',
  auto_merge_by        integer REFERENCES users(id),
  merged_by            text,
  merge_commit         text,
  checks               jsonb NOT NULL DEFAULT '[]',
  rules_snapshot       text NOT NULL DEFAULT '',
  created_at           bigint NOT NULL,
  updated_at           bigint NOT NULL,
  UNIQUE (project_id, iid)
);
CREATE INDEX IF NOT EXISTS merge_requests_source ON merge_requests (project_id, source);
CREATE INDEX IF NOT EXISTS merge_requests_target ON merge_requests (project_id, target);

CREATE TABLE IF NOT EXISTS mr_versions (
  mr_id       integer NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  number      integer NOT NULL,
  base        text,
  head        text NOT NULL,
  start       text,
  created_at  bigint NOT NULL,
  PRIMARY KEY (mr_id, number)
);

CREATE TABLE IF NOT EXISTS mr_threads (
  id             serial PRIMARY KEY,
  mr_id          integer NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  author_id      integer NOT NULL REFERENCES users(id),
  path           text,
  old_line       integer,
  new_line       integer,
  end_line       integer,
  version        integer,
  current_line   integer,
  current_end    integer,
  outdated       boolean NOT NULL DEFAULT false,
  resolved       boolean NOT NULL DEFAULT false,
  pending        boolean NOT NULL DEFAULT false,
  created_at     bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS mr_threads_mr ON mr_threads (mr_id, id);

CREATE TABLE IF NOT EXISTS mr_notes (
  id          serial PRIMARY KEY,
  mr_id       integer NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  thread_id   integer REFERENCES mr_threads(id) ON DELETE CASCADE,
  author      text NOT NULL,
  user_id     integer REFERENCES users(id),
  body        text NOT NULL,
  system      boolean NOT NULL DEFAULT false,
  pending     boolean NOT NULL DEFAULT false,
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS mr_notes_mr ON mr_notes (mr_id, id);
CREATE INDEX IF NOT EXISTS mr_notes_thread ON mr_notes (thread_id, id);

CREATE TABLE IF NOT EXISTS mr_suggestions (
  id          serial PRIMARY KEY,
  mr_id       integer NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  thread_id   integer NOT NULL REFERENCES mr_threads(id) ON DELETE CASCADE,
  note_id     integer NOT NULL REFERENCES mr_notes(id) ON DELETE CASCADE,
  above       integer NOT NULL,
  below       integer NOT NULL,
  lines       text[] NOT NULL DEFAULT '{}',
  start_line  integer NOT NULL,
  end_line    integer NOT NULL,
  outdated    boolean NOT NULL DEFAULT false,
  applied     boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS mr_suggestions_thread ON mr_suggestions (thread_id, id);
CREATE INDEX IF NOT EXISTS mr_suggestions_mr ON mr_suggestions (mr_id, id);

CREATE TABLE IF NOT EXISTS mr_approvals (
  mr_id       integer NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id),
  created_at  bigint NOT NULL,
  PRIMARY KEY (mr_id, user_id)
);

CREATE TABLE IF NOT EXISTS mr_reviews (
  id          serial PRIMARY KEY,
  mr_id       integer NOT NULL REFERENCES merge_requests(id) ON DELETE CASCADE,
  user_id     integer NOT NULL REFERENCES users(id),
  summary     text NOT NULL DEFAULT '',
  published   integer NOT NULL,
  created_at  bigint NOT NULL
);
