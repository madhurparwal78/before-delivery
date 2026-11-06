-- Photo signing keys as a ring in Postgres, rotated once per generation (brief: Photo URLs, Key ring).
CREATE TABLE signing_keys (
  id text PRIMARY KEY,
  generation integer NOT NULL UNIQUE,
  secret text NOT NULL,
  created_at timestamptz NOT NULL,
  -- The latest expiry of any path this key signed; a retired key is removed only after it.
  signs_until timestamptz NOT NULL
);
DROP TABLE app_secrets;

-- A vet link follows its horse's two most recent visits that are not open at each read, and each view row
-- records the pair it served (brief: Vet links, Live pair; View log).
ALTER TABLE vet_links DROP COLUMN previous_visit_id, DROP COLUMN current_visit_id;
ALTER TABLE vet_link_views ADD COLUMN previous_visit_id text REFERENCES visits (id), ADD COLUMN current_visit_id text REFERENCES visits (id);

-- Closing a visit ends its live upload sessions (brief: Resumable uploads, Close ends sessions).
ALTER TABLE upload_sessions DROP CONSTRAINT upload_sessions_state_check;
ALTER TABLE upload_sessions ADD CONSTRAINT upload_sessions_state_check CHECK (state IN ('active', 'stored', 'released', 'ended'));
