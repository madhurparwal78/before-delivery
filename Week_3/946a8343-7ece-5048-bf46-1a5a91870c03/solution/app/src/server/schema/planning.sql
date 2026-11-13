-- planning tables (owned by the planning module). Idempotent: CREATE TABLE IF NOT EXISTS only.

-- A label belongs to a project or to a group; a project sees its own and every ancestor group's. Issues and epics keep
-- label names, and a project label with the same name wins over a group label.
CREATE TABLE IF NOT EXISTS labels (
  id           serial PRIMARY KEY,
  project_id   integer REFERENCES projects(id) ON DELETE CASCADE,
  group_id     integer REFERENCES groups(id) ON DELETE CASCADE,
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  created_at   bigint NOT NULL,
  CHECK ((project_id IS NULL) <> (group_id IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS labels_project_name ON labels (project_id, name) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS labels_group_name ON labels (group_id, name) WHERE group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS milestones (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  title       text NOT NULL,
  start_date  text NOT NULL,
  due_date    text NOT NULL,
  time_zone   text NOT NULL,
  state       text NOT NULL DEFAULT 'active' CHECK (state IN ('active', 'closed')),
  created_at  bigint NOT NULL,
  UNIQUE (project_id, title)
);

ALTER TABLE groups ADD COLUMN IF NOT EXISTS next_epic_iid integer NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS epics (
  id            serial PRIMARY KEY,
  group_id      integer NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  iid           integer NOT NULL,
  title         text NOT NULL,
  description   text NOT NULL DEFAULT '',
  author_id     integer NOT NULL REFERENCES users(id),
  state         text NOT NULL DEFAULT 'opened' CHECK (state IN ('opened', 'closed')),
  confidential  boolean NOT NULL DEFAULT false,
  parent_id     integer REFERENCES epics(id) ON DELETE SET NULL,
  labels        text[] NOT NULL DEFAULT '{}',
  created_at    bigint NOT NULL,
  UNIQUE (group_id, iid)
);
CREATE INDEX IF NOT EXISTS epics_parent ON epics (parent_id);

-- `position` orders cards across every list of a board (a card keeps one rank); `card_version` counts that card's moves.
CREATE TABLE IF NOT EXISTS issues (
  id                  serial PRIMARY KEY,
  project_id          integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  iid                 integer NOT NULL,
  title               text NOT NULL,
  description         text NOT NULL DEFAULT '',
  state               text NOT NULL DEFAULT 'opened' CHECK (state IN ('opened', 'closed')),
  author_id           integer NOT NULL REFERENCES users(id),
  confidential        boolean NOT NULL DEFAULT false,
  labels              text[] NOT NULL DEFAULT '{}',
  milestone_id        integer REFERENCES milestones(id) ON DELETE SET NULL,
  weight              integer,
  due_date            text,
  estimate_minutes    integer,
  spent_minutes       integer NOT NULL DEFAULT 0,
  epic_id             integer REFERENCES epics(id) ON DELETE SET NULL,
  position            double precision NOT NULL DEFAULT 0,
  card_version        integer NOT NULL DEFAULT 0,
  last_move_user_id   integer REFERENCES users(id),
  created_at          bigint NOT NULL,
  updated_at          bigint NOT NULL,
  closed_at           bigint,
  UNIQUE (project_id, iid)
);
CREATE INDEX IF NOT EXISTS issues_milestone ON issues (milestone_id);
CREATE INDEX IF NOT EXISTS issues_epic ON issues (epic_id);

CREATE TABLE IF NOT EXISTS issue_assignees (
  issue_id  integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  user_id   integer NOT NULL REFERENCES users(id),
  PRIMARY KEY (issue_id, user_id)
);
CREATE INDEX IF NOT EXISTS issue_assignees_user ON issue_assignees (user_id);

-- Comments and system notes of an issue; `author` is a username or `system`.
CREATE TABLE IF NOT EXISTS issue_notes (
  id          serial PRIMARY KEY,
  issue_id    integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  author      text NOT NULL,
  body        text NOT NULL,
  system      boolean NOT NULL,
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS issue_notes_issue ON issue_notes (issue_id, id);

CREATE TABLE IF NOT EXISTS epic_notes (
  id          serial PRIMARY KEY,
  epic_id     integer NOT NULL REFERENCES epics(id) ON DELETE CASCADE,
  author      text NOT NULL,
  body        text NOT NULL,
  system      boolean NOT NULL,
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS epic_notes_epic ON epic_notes (epic_id, id);

CREATE TABLE IF NOT EXISTS issue_links (
  id          serial PRIMARY KEY,
  source_id   integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  target_id   integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('relates', 'blocks', 'blocked by')),
  created_at  bigint NOT NULL,
  UNIQUE (source_id, target_id, kind)
);
CREATE INDEX IF NOT EXISTS issue_links_target ON issue_links (target_id);

-- The event log the burndown reads: one row at creation and one at each change of weight or state.
CREATE TABLE IF NOT EXISTS issue_history (
  id        serial PRIMARY KEY,
  issue_id  integer NOT NULL REFERENCES issues(id) ON DELETE CASCADE,
  at        bigint NOT NULL,
  weight    integer,
  state     text NOT NULL
);
CREATE INDEX IF NOT EXISTS issue_history_issue ON issue_history (issue_id, at, id);

CREATE TABLE IF NOT EXISTS boards (
  id          serial PRIMARY KEY,
  project_id  integer REFERENCES projects(id) ON DELETE CASCADE,
  group_id    integer REFERENCES groups(id) ON DELETE CASCADE,
  name        text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('label', 'assignee', 'milestone')),
  created_at  bigint NOT NULL,
  CHECK ((project_id IS NULL) <> (group_id IS NULL))
);
CREATE INDEX IF NOT EXISTS boards_project ON boards (project_id);
CREATE INDEX IF NOT EXISTS boards_group ON boards (group_id);

-- `ref` is the label name, username or milestone title a list stands for; the two fixed lists have none.
CREATE TABLE IF NOT EXISTS board_lists (
  id        serial PRIMARY KEY,
  board_id  integer NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  kind      text NOT NULL CHECK (kind IN ('open', 'list', 'closed')),
  title     text NOT NULL,
  ref       text,
  position  integer NOT NULL
);
CREATE INDEX IF NOT EXISTS board_lists_board ON board_lists (board_id, position);

CREATE TABLE IF NOT EXISTS wiki_versions (
  id          serial PRIMARY KEY,
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  slug        text NOT NULL,
  version     integer NOT NULL,
  title       text NOT NULL,
  content     text NOT NULL,
  author      text NOT NULL,
  created_at  bigint NOT NULL,
  UNIQUE (project_id, slug, version)
);
