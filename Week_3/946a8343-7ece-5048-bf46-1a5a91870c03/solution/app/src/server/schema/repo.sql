-- Repository objects are content addressed and kept per project. A blob larger than SPUR_INLINE_MAX_BYTES lives in file
-- storage under blobs/<blob id>; `external` turns true only after the upload succeeded.

CREATE TABLE IF NOT EXISTS blobs (
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id          text NOT NULL,
  size        integer NOT NULL,
  inline      bytea,
  external    boolean NOT NULL DEFAULT false,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE IF NOT EXISTS trees (
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id          text NOT NULL,
  entries     jsonb NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE IF NOT EXISTS commits (
  project_id    integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  id            text NOT NULL,
  tree          text NOT NULL,
  parents       text[] NOT NULL DEFAULT '{}',
  author        text NOT NULL,
  authored_at   bigint NOT NULL,
  committer     text NOT NULL,
  committed_at  bigint NOT NULL,
  message       text NOT NULL,
  PRIMARY KEY (project_id, id)
);

CREATE TABLE IF NOT EXISTS refs (
  project_id  integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('branch', 'tag')),
  name        text NOT NULL,
  commit_id   text NOT NULL,
  message     text,
  creator     text,
  created_at  bigint NOT NULL,
  PRIMARY KEY (project_id, kind, name)
);
