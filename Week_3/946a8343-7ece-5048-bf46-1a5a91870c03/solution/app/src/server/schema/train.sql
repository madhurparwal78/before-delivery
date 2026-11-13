-- train tables (owned by the train module). Idempotent: CREATE TABLE IF NOT EXISTS only.

-- One row per train car. `sha` is the stored speculative commit, `base_sha` the commit it was built on top of (the previous
-- car's speculative commit, or the target head for the first car), `source_sha` the request's source head it merged.
CREATE TABLE IF NOT EXISTS train_cars (
  id           serial PRIMARY KEY,
  project_id   integer NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  target       text NOT NULL,
  mr_id        integer NOT NULL,
  mr_iid       integer NOT NULL,
  source       text NOT NULL,
  author       text NOT NULL,
  added_by     integer NOT NULL REFERENCES users(id),
  position     integer NOT NULL,
  sha          text NOT NULL,
  base_sha     text NOT NULL,
  source_sha   text NOT NULL,
  pipeline_id  integer,
  pipeline_at  bigint,
  UNIQUE (project_id, mr_id)
);
CREATE INDEX IF NOT EXISTS train_cars_order ON train_cars (project_id, target, position);
CREATE INDEX IF NOT EXISTS train_cars_pipeline ON train_cars (pipeline_id);
